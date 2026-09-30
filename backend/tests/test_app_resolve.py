import os
import shutil
import subprocess
from pathlib import Path
import json

def resolve_installed_app(app_name: str) -> str | None:
    query = app_name.strip().lower()
    
    # 1. Direct path check
    direct = Path(app_name)
    if direct.is_file() and direct.suffix.lower() in ('.exe', '.bat', '.cmd'):
        return str(direct.resolve())
        
    # 2. PATH check
    found = shutil.which(query) or shutil.which(f"{query}.exe")
    if found:
        return found
        
    # 3. Known / cached mappings
    cache_file = Path("backend/data/app_cache.json")
    if cache_file.exists():
        try:
            cache = json.loads(cache_file.read_text(encoding="utf-8"))
            if query in cache and Path(cache[query]).exists():
                return cache[query]
        except Exception:
            pass

    # 4. Search Local Programs
    local_progs = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs"
    if local_progs.exists():
        for p in local_progs.iterdir():
            if query in p.name.lower():
                # Look for matching exe
                for exe in p.glob("*.exe"):
                    if not any(skip in exe.name.lower() for skip in ["uninstall", "unins", "update", "crash"]):
                        return str(exe.resolve())

    # 5. Search Start Menu Shortcuts
    start_menus = [
        Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs",
        Path(os.environ.get("ProgramData", "")) / "Microsoft/Windows/Start Menu/Programs",
    ]
    for sm in start_menus:
        if not sm.exists():
            continue
        for lnk in sm.rglob("*.lnk"):
            stem = lnk.stem.lower()
            if query == stem or query in stem:
                # Read shortcut target
                try:
                    ps = f"(New-Object -ComObject WScript.Shell).CreateShortcut('{lnk}').TargetPath"
                    res = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, timeout=5)
                    target = res.stdout.strip()
                    if target and Path(target).exists():
                        return target
                except Exception:
                    pass

    # 6. Program Files
    for pf in [os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")]:
        if not pf:
            continue
        pf_dir = Path(pf)
        if pf_dir.exists():
            for p in pf_dir.iterdir():
                if query in p.name.lower():
                    for exe in p.glob("*.exe"):
                        if not any(skip in exe.name.lower() for skip in ["uninstall", "unins", "update", "helper"]):
                            return str(exe.resolve())

    return None

if __name__ == "__main__":
    for name in ["antigravity", "antigravity ide", "notepad", "calc"]:
        res = resolve_installed_app(name)
        print(f"Resolved '{name}' -> {res}")
