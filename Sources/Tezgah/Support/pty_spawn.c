#include "pty_spawn.h"
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>
#include <util.h>

pid_t tz_pty_spawn(const char *path, char *const argv[], char *const envp[], const char *cwd,
                   unsigned short cols, unsigned short rows, int *master_fd) {
    struct winsize ws = {.ws_row = rows, .ws_col = cols, .ws_xpixel = 0, .ws_ypixel = 0};
    int master = -1;
    // forkpty: openpty + fork + setsid + TIOCSCTTY + the slave on 0/1/2 in the child.
    pid_t pid = forkpty(&master, NULL, NULL, &ws);
    if (pid < 0) return -1;
    if (pid == 0) {
        // Only async-signal-safe calls from here to exec.
        sigset_t none;
        sigemptyset(&none);
        sigprocmask(SIG_SETMASK, &none, NULL);
        for (int s = 1; s < NSIG; s++) signal(s, SIG_DFL);
        // Close every descriptor the app had open (the child keeps 0, 1, 2).
        int max = (int)sysconf(_SC_OPEN_MAX);
        if (max < 0 || max > 65536) max = 65536;
        for (int fd = 3; fd < max; fd++) close(fd);
        if (cwd && chdir(cwd) != 0) (void)chdir("/");
        execve(path, argv, envp);
        _exit(127);
    }
    int flags = fcntl(master, F_GETFD);
    if (flags >= 0) fcntl(master, F_SETFD, flags | FD_CLOEXEC);
    *master_fd = master;
    return pid;
}

int tz_pty_resize(int master_fd, unsigned short cols, unsigned short rows, unsigned short px_w, unsigned short px_h) {
    struct winsize ws = {.ws_row = rows, .ws_col = cols, .ws_xpixel = px_w, .ws_ypixel = px_h};
    return ioctl(master_fd, TIOCSWINSZ, &ws);
}

pid_t tz_pty_foreground(int master_fd) {
    return tcgetpgrp(master_fd);
}
