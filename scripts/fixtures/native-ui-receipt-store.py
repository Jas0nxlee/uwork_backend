"""Only allocate files for the fixed, prevalidated primary UI dispatcher outputs."""
from pathlib import Path
import os
import stat

OBSERVATIONS = frozenset(("observe", "first_run_observe", "preworkspace"))
BUSINESS = frozenset(("cache_prelogin", "login_once", "prepare_question", "send_once",
    "identity_menu_first", "open_gateway", "back_to_workspace", "return_conversation", "identity_menu_logout",
    "logout_once", "prepare_denied_question", "send_denied_once",
    "first_run_skip_login", "first_run_select_developer", "first_run_next_role",
    "first_run_select_coding", "first_run_next_mode", "first_run_finish", "first_run_reopen_login"))


def reserve_result_file(directory, epoch, phase):
    """Allocate within an owned canonical directory capability; payload is validated upstream."""
    directory_fd = None
    try:
        raw = os.fspath(directory)
        if type(raw) is not str or not os.path.isabs(raw) or raw.startswith('//') or os.path.normpath(raw) != raw or any(ord(char) < 32 for char in raw):
            raise ValueError()
        if type(epoch) is not int or epoch not in (1, 2, 3) or phase not in OBSERVATIONS | BUSINESS:
            raise ValueError()
        if (phase.startswith('first_run_') or phase == 'preworkspace') and epoch != 1:
            raise ValueError()
        if phase == 'back_to_workspace' and epoch != 2:
            raise ValueError()
        # Open each known component without following a symlink, including parent components.
        directory_fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        for component in Path(raw).parts[1:]:
            next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_fd
        info = os.fstat(directory_fd)
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError()
        prefix = f"ui-e{epoch}-{phase.replace('_', '-')}"
        candidates = (f"{prefix}-observation-{n:04d}.json" for n in range(1, 129)) if phase in OBSERVATIONS else iter((prefix + '.json',))
        for name in candidates:
            try:
                fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory_fd)
                return fd, name
            except FileExistsError:
                existing = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if phase not in OBSERVATIONS or not stat.S_ISREG(existing.st_mode) or existing.st_uid != os.geteuid() or stat.S_IMODE(existing.st_mode) != 0o600:
                    raise ValueError()
        raise ValueError()
    except Exception:
        raise ValueError('PRIMARY_UI_OUTPUT_REJECTED') from None
    finally:
        if directory_fd is not None:
            os.close(directory_fd)
