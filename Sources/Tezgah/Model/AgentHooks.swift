import Foundation

/// How agents started in Tezgah tell it what they're doing.
///
/// Tezgah puts small shims named `claude` and `codex` first on the panes' PATH. A shim finds the
/// real program further down the PATH and starts it with hooks for this run only (Claude Code's
/// `--settings`, Codex's `-c hooks…`): the user's own agent configuration is never edited. The
/// hooks print an OSC 7501 report, signed with the pane's token, to the terminal. Turning
/// "Report status" off for an agent removes its shim.
enum AgentHooks {
    static var binDirectory: URL? {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Tezgah"
        return support.appendingPathComponent(name, isDirectory: true).appendingPathComponent("bin", isDirectory: true)
    }

    /// The agents Tezgah has a hook for; the others are seen only if they report by themselves.
    static let hooked: Set<AgentKind> = [.claude, .codex]

    /// Where zsh is pointed (ZDOTDIR) for its first file only; see `zshenv`.
    static var zshDirectory: URL? {
        binDirectory?.deletingLastPathComponent().appendingPathComponent("shell/zsh", isDirectory: true)
    }

    /// Tezgah's one line of say in a zsh pane. zsh reads `.zshenv` from ZDOTDIR first: this one hands
    /// ZDOTDIR straight back (to what it was, or unset), runs the user's own `.zshenv`, and zsh goes on
    /// to read the user's `.zprofile`, `.zshrc` and `.zlogin` as always: none of the user's files is touched.
    /// Just before the first prompt, after every rc file has had its say about PATH, it puts Tezgah's
    /// folder first (so `claude` and `codex` are the ones that report their state; installers that
    /// prepend to PATH in `.zshrc` would otherwise hide them) and tells the pane the shell is ready.
    static let zshenv = #"""
    # Tezgah: zsh integration. Your own files are read as usual; see Settings › Agents.
    if [[ -n "${TEZGAH_ZDOTDIR+x}" ]]; then
      builtin export ZDOTDIR="$TEZGAH_ZDOTDIR"
      builtin unset TEZGAH_ZDOTDIR
    else
      builtin unset ZDOTDIR
    fi
    if [[ -f "${ZDOTDIR:-$HOME}/.zshenv" ]]; then
      builtin source "${ZDOTDIR:-$HOME}/.zshenv"
    fi
    if [[ -o interactive && -n "$TEZGAH_PANE_TOKEN" ]]; then
      _tezgah_ready() {
        if [[ -n "$TEZGAH_BIN" && -d "$TEZGAH_BIN" ]]; then
          path=("$TEZGAH_BIN" "${(@)path:#$TEZGAH_BIN}")
        fi
        builtin printf '\033]7501;ready=1:token=%s\007' "$TEZGAH_PANE_TOKEN"
        precmd_functions=("${(@)precmd_functions:#_tezgah_ready}")
        builtin unfunction _tezgah_ready 2>/dev/null
      }
      precmd_functions+=(_tezgah_ready)
    fi
    """#

    static func reports(_ kind: AgentKind) -> Bool {
        UserDefaults.standard.object(forKey: "agents.report.\(kind.rawValue)") as? Bool ?? true
    }

    /// Writes (or removes) the shims to match the settings. Safe to call often.
    static func install() {
        guard let bin = binDirectory else { return }
        let fm = FileManager.default
        try? fm.createDirectory(at: bin, withIntermediateDirectories: true)
        write(bin.appendingPathComponent("tezgah-report"), report, executable: true)
        if let zsh = zshDirectory {
            try? fm.createDirectory(at: zsh, withIntermediateDirectories: true)
            write(zsh.appendingPathComponent(".zshenv"), zshenv, executable: false)
        }
        write(bin.appendingPathComponent("claude-hooks.json"), claudeSettings(bin: bin.path), executable: false)
        for (kind, shim) in [(AgentKind.claude, claudeShim), (.codex, codexShim)] {
            let url = bin.appendingPathComponent(kind.command)
            if reports(kind) { write(url, shim, executable: true) } else { try? fm.removeItem(at: url) }
        }
    }

    private static func write(_ url: URL, _ text: String, executable: Bool) {
        if (try? String(contentsOf: url, encoding: .utf8)) != text {
            try? text.write(to: url, atomically: true, encoding: .utf8)
        }
        if executable { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path) }
    }

    /// `tezgah-report <state> <app>`: the event JSON arrives on stdin; its message, if any, goes along.
    static let report = #"""
    #!/bin/sh
    # Tezgah: reports an agent's state to the pane it runs in (OSC 7501). Silent outside Tezgah.
    [ -n "$TEZGAH_PANE_TOKEN" ] || exit 0
    state=$1; app=$2
    msg=""; sid=""
    if [ ! -t 0 ]; then
      input=$(head -c 65536)
      msg=$(printf '%s' "$input" | /usr/bin/sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 | cut -c1-300 | /usr/bin/base64 | tr -d '\n')
      # The conversation, so Tezgah can come back to it after a restart.
      sid=$(printf '%s' "$input" | /usr/bin/sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9-]*\)".*/\1/p' | head -n 1 | cut -c1-64)
    fi
    if [ "$state" = "blocked" ]; then
      # Claude Code also sends a notification when its prompt has sat idle for a minute: that is not waiting on a permission.
      case "$input" in *'"notification_type":"idle_prompt"'*|*'"notification_type": "idle_prompt"'*|*'waiting for your input'*) exit 0 ;; esac
    fi
    kind=""
    [ "$state" = "blocked" ] && kind=":kind=permission"
    [ -n "$sid" ] && kind="$kind:sid=$sid"
    printf '\033]7501;state=%s:app=%s%s:msg=%s:token=%s\007' "$state" "$app" "$kind" "$msg" "$TEZGAH_PANE_TOKEN" > /dev/tty 2>/dev/null
    exit 0
    """#

    static func claudeSettings(bin: String) -> String {
        let r = bin + "/tezgah-report"
        func hook(_ state: String) -> String { #"[{"hooks":[{"type":"command","command":"'\#(r)' \#(state) claude","timeout":5}]}]"# }
        return """
        {"hooks":{"SessionStart":\(hook("idle")),"UserPromptSubmit":\(hook("working")),"PreToolUse":\(hook("working")),"PostToolUse":\(hook("working")),"Notification":\(hook("blocked")),\
        "Stop":\(hook("done")),"SubagentStop":\(hook("working")),"SessionEnd":\(hook("clear"))}}
        """
    }

    /// Finds the real program after this shim on PATH.
    private static func findReal(_ name: String) -> String {
        #"""
        self_dir=$(cd "$(dirname "$0")" && pwd)
        real=""
        old_ifs=$IFS; IFS=:
        for d in $PATH; do
          [ "$d" = "$self_dir" ] && continue
          case "$d" in *.app/Contents/*) continue ;; esac
          if [ -x "$d/\#(name)" ]; then real="$d/\#(name)"; break; fi
        done
        IFS=$old_ifs
        if [ -z "$real" ]; then echo "\#(name): not installed" >&2; exit 127; fi
        """#
    }

    static let claudeShim = #"""
    #!/bin/sh
    # Tezgah's `claude`: runs the real Claude Code with hooks that report its state to Tezgah,
    # for this run only (--settings); your Claude settings are not changed. TEZGAH_AGENT_HOOKS=0 skips them.
    \#(findReal("claude"))
    [ -n "$TEZGAH_PANE_TOKEN" ] && [ "$TEZGAH_AGENT_HOOKS" != "0" ] || exec "$real" "$@"
    for a in "$@"; do
      case "$a" in -p|--print|--help|-h|--version|-v|mcp|config|update|doctor|install|setup-token|migrate-installer) exec "$real" "$@" ;; esac
    done
    exec "$real" --settings "$self_dir/claude-hooks.json" "$@"
    """#

    static let codexShim = #"""
    #!/bin/sh
    # Tezgah's `codex`: runs the real Codex with hooks that report its state to Tezgah, for this run
    # only (-c); your Codex config is not changed. TEZGAH_AGENT_HOOKS=0 skips them.
    \#(findReal("codex"))
    [ -n "$TEZGAH_PANE_TOKEN" ] && [ "$TEZGAH_AGENT_HOOKS" != "0" ] || exec "$real" "$@"
    first=""
    for a in "$@"; do case "$a" in -*) continue ;; *) first=$a; break ;; esac; done
    case "$first" in
      login|logout|mcp|mcp-server|app-server|completion|apply|sandbox|debug|help|features|cloud|app|version|exec) exec "$real" "$@" ;;
    esac
    for a in "$@"; do case "$a" in --help|-h|--version|-V) exec "$real" "$@" ;; esac; done
    r=$(printf '%s' "$self_dir/tezgah-report" | sed "s/'/'\\\\''/g")
    hook() { printf 'hooks.%s=[{hooks=[{type="command",command='"'''"' '\''%s'\'' %s codex '"'''"',timeout=5000}]}]' "$1" "$r" "$2"; }
    exec "$real" --enable hooks \
      -c "$(hook UserPromptSubmit working)" \
      -c "$(hook PreToolUse working)" \
      -c "$(hook PermissionRequest blocked)" \
      -c "$(hook Stop done)" \
      "$@"
    """#
}
