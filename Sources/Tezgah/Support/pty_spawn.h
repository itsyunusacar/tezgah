#ifndef TZ_PTY_SPAWN_H
#define TZ_PTY_SPAWN_H
#include <sys/types.h>

/// Starts `path` with `argv`/`envp` on a new pseudo-terminal of `cols`×`rows`, in `cwd`, as the
/// leader of a new session with the terminal as its controlling tty. Returns the child's pid
/// (and the master side in *master_fd), or -1 with errno set.
pid_t tz_pty_spawn(const char *path, char *const argv[], char *const envp[], const char *cwd,
                   unsigned short cols, unsigned short rows, int *master_fd);

/// Sets the terminal's size (the kernel tells the foreground job with SIGWINCH).
int tz_pty_resize(int master_fd, unsigned short cols, unsigned short rows, unsigned short px_w, unsigned short px_h);

/// The process group in the terminal's foreground, or -1.
pid_t tz_pty_foreground(int master_fd);
#endif
