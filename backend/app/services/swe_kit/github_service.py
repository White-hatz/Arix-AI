"""GitHub service for SWE-Kit: integration status, token validation, and Git/PR operations."""

from __future__ import annotations

import logging
import os
import re
import subprocess
from typing import Any
import urllib.parse
import urllib.request
import json

from backend.app.api.settings import load_backend_config, save_backend_config

logger = logging.getLogger("backend.services.swe_kit.github")


def verify_github_token(token: str) -> dict[str, Any]:
    """Validates a GitHub token against api.github.com/user."""
    clean_token = token.strip()
    if not clean_token:
        return {"valid": False, "error": "Token is empty"}

    req = urllib.request.Request(
        "https://api.github.com/user",
        headers={
            "Authorization": f"Bearer {clean_token}",
            "User-Agent": "Arix-AI-Desktop/0.1.0",
            "Accept": "application/vnd.github+json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=6.0) as res:
            if res.status == 200:
                data = json.loads(res.read().decode("utf-8"))
                return {
                    "valid": True,
                    "username": data.get("login", ""),
                    "name": data.get("name", ""),
                    "avatar_url": data.get("avatar_url", ""),
                    "email": data.get("email", ""),
                }
            return {"valid": False, "error": f"Unexpected status {res.status}"}
    except urllib.error.HTTPError as err:
        return {"valid": False, "error": f"GitHub API HTTP error: {err.code} {err.reason}"}
    except Exception as err:
        return {"valid": False, "error": f"GitHub connection error: {err}"}


def connect_github_token(token: str) -> dict[str, Any]:
    """Verifies and persists a GitHub token in encrypted backend settings."""
    ver = verify_github_token(token)
    if not ver.get("valid"):
        return {"ok": False, "error": ver.get("error", "Invalid GitHub token")}

    current = load_backend_config()
    current["githubToken"] = token.strip()
    current["githubUsername"] = ver.get("username", "")
    current["githubAvatarUrl"] = ver.get("avatar_url", "")
    save_backend_config(current)

    return {
        "ok": True,
        "username": ver.get("username", ""),
        "avatar_url": ver.get("avatar_url", ""),
        "message": f"Successfully connected as @{ver.get('username')}.",
    }


def disconnect_github() -> dict[str, Any]:
    """Removes stored GitHub token from backend config."""
    current = load_backend_config()
    current.pop("githubToken", None)
    current.pop("githubUsername", None)
    current.pop("githubAvatarUrl", None)
    save_backend_config(current)
    return {"ok": True, "message": "Disconnected GitHub account."}


def get_repo_remote_info(workspace_root: str) -> dict[str, str]:
    """Extracts GitHub owner and repo name from local git remote."""
    try:
        proc = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=workspace_root,
            capture_output=True,
            text=True,
            timeout=3.0,
            shell=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if proc.returncode != 0:
            return {}
        raw_url = proc.stdout.strip()
        # Handle git@github.com:owner/repo.git or https://github.com/owner/repo.git
        match = re.search(r"github\.com[:/]([^/]+)/([^/.]+)(?:\.git)?", raw_url)
        if match:
            return {"owner": match.group(1), "repo": match.group(2), "url": raw_url}
    except Exception:
        pass
    return {}


def run_git_operation(
    workspace_root: str,
    action: str,
    branch_name: str = "",
    commit_message: str = "",
    pr_title: str = "",
    pr_body: str = "",
) -> dict[str, Any]:
    """Executes safe Git and GitHub operations for the Coder Agent."""
    if not os.path.exists(workspace_root):
        return {"success": False, "error": f"Workspace directory not found: {workspace_root}"}

    def run_cmd(args: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            args,
            cwd=workspace_root,
            capture_output=True,
            text=True,
            timeout=30.0,
            shell=False,
            encoding="utf-8",
            errors="replace",
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )

    action = action.lower().strip()

    if action == "status":
        p = run_cmd(["git", "status", "--porcelain", "-b"])
        return {
            "success": p.returncode == 0,
            "action": "status",
            "output": p.stdout if p.returncode == 0 else p.stderr,
        }

    elif action == "diff":
        p = run_cmd(["git", "diff"])
        p_cached = run_cmd(["git", "diff", "--cached"])
        combined_diff = (p.stdout + "\n" + p_cached.stdout).strip()
        return {
            "success": True,
            "action": "diff",
            "diff": combined_diff,
            "has_changes": bool(combined_diff),
        }

    elif action == "branch":
        if not branch_name:
            # List current branch
            p = run_cmd(["git", "branch", "--show-current"])
            return {"success": True, "action": "branch", "current_branch": p.stdout.strip()}
        # Create or switch to branch
        p = run_cmd(["git", "checkout", "-B", branch_name])
        return {
            "success": p.returncode == 0,
            "action": "branch",
            "branch": branch_name,
            "output": p.stdout or p.stderr,
        }

    elif action == "commit":
        if not commit_message:
            return {"success": False, "error": "commit_message is required for commit action"}
        run_cmd(["git", "add", "-A"])
        p = run_cmd(["git", "commit", "-m", commit_message])
        return {
            "success": p.returncode == 0,
            "action": "commit",
            "message": commit_message,
            "output": p.stdout if p.returncode == 0 else p.stderr,
        }

    elif action == "push":
        args = ["git", "push"]
        if branch_name:
            args.extend(["-u", "origin", branch_name])
        p = run_cmd(args)
        return {
            "success": p.returncode == 0,
            "action": "push",
            "branch": branch_name,
            "output": p.stdout if p.returncode == 0 else p.stderr,
        }

    elif action == "create_pr":
        config = load_backend_config()
        token = config.get("githubToken") or os.getenv("GITHUB_TOKEN", "")
        if not token:
            return {
                "success": False,
                "error": (
                    "GitHub account is not connected. Please connect your GitHub account in "
                    "Settings -> Integrations to allow automatic Pull Request creation."
                ),
            }

        remote = get_repo_remote_info(workspace_root)
        if not remote:
            return {
                "success": False,
                "error": "Could not determine GitHub repository from 'origin' remote.",
            }

        owner, repo = remote["owner"], remote["repo"]
        # Determine current branch
        curr_branch = branch_name or run_cmd(["git", "branch", "--show-current"]).stdout.strip()
        if not curr_branch or curr_branch in ("main", "master"):
            return {
                "success": False,
                "error": f"Cannot create PR from '{curr_branch}'. Create a feature branch first.",
            }

        # Push branch first if needed
        run_cmd(["git", "push", "-u", "origin", curr_branch])

        payload = {
            "title": pr_title or f"Updates from {curr_branch}",
            "head": curr_branch,
            "base": "main",
            "body": pr_body or f"Autonomous code updates generated by Arix Coder Agent on branch `{curr_branch}`.",
        }

        req = urllib.request.Request(
            f"https://api.github.com/repos/{owner}/{repo}/pulls",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {token}",
                "User-Agent": "Arix-AI-Desktop/0.1.0",
                "Accept": "application/vnd.github+json",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10.0) as res:
                res_data = json.loads(res.read().decode("utf-8"))
                pr_url = res_data.get("html_url", "")
                pr_number = res_data.get("number")
                return {
                    "success": True,
                    "action": "create_pr",
                    "pr_url": pr_url,
                    "pr_number": pr_number,
                    "message": f"Created Pull Request #{pr_number}: {pr_url}",
                }
        except urllib.error.HTTPError as err:
            body = err.read().decode("utf-8", "replace")
            return {"success": False, "error": f"GitHub PR creation failed ({err.code}): {body}"}
        except Exception as err:
            return {"success": False, "error": f"Failed to create PR: {err}"}

    return {"success": False, "error": f"Unknown Git action: {action}"}
