# Arix AI — Complete Docker Setup & Sharing Guide

This comprehensive guide walks you through everything from **installing Docker** from scratch, to **building and running Arix AI**, **exporting/sending the container to a friend**, **running it on your friend's computer**, and **extracting the project files out of the container so they can make changes and develop**.

---

## Table of Contents
1. [Prerequisites & Installing Docker](#1-prerequisites--installing-docker)
   - [Windows (Docker Desktop + WSL 2)](#windows-installation)
   - [macOS (Apple Silicon & Intel)](#macos-installation)
   - [Linux (Ubuntu / Debian)](#linux-installation)
2. [Building & Running Arix AI on Your Machine](#2-building--running-arix-ai-on-your-machine)
   - [Option A: One-Command Start with Docker Compose (Recommended)](#option-a-using-docker-compose-recommended)
   - [Option B: Using Standard Docker Commands](#option-b-using-standard-docker-cli)
3. [How to Send the Docker Container to Your Friend](#3-how-to-send-the-docker-container-to-your-friend)
   - [Method 1: Export as a Single `.tar` File (Offline / USB / Drive)](#method-1-export-as-a-single-tar-file-offline--drive)
   - [Method 2: Send Project ZIP / Git Repo (Easiest to edit)](#method-2-send-project-zip--git-repository)
   - [Method 3: Publish to Docker Hub](#method-3-publish-to-docker-hub-cloud-registry)
4. [How Your Friend Runs It on Their Computer](#4-how-your-friend-runs-it-on-their-computer)
5. [How to Take All Files Out of the Container to Make Changes](#5-how-to-take-all-files-out-of-the-container-to-make-changes)
   - [Approach 1: Extract Files from Image via `docker cp`](#approach-1-extract-the-source-code-from-the-container-docker-cp)
   - [Approach 2: Live Code Editing with Volume Mounting (No Rebuild Needed)](#approach-2-live-code-editing-with-volume-mounting-bind-mounts)
   - [Approach 3: Rebuilding the Container After Changes](#approach-3-rebuilding-the-container-after-editing)
6. [Accessing Microphone & Voice in the Browser](#6-accessing-microphone--voice-in-the-browser)
7. [Helpful Docker Commands Cheat Sheet](#7-helpful-docker-commands-cheat-sheet)
8. [Troubleshooting & FAQs](#8-troubleshooting--faqs)

---

## 1. Prerequisites & Installing Docker

If you or your friend do not have Docker installed yet, follow these steps for your operating system:

### Windows Installation
1. **Enable Hardware Virtualization**:
   - Open **Task Manager** (`Ctrl + Shift + Esc`) -> Click the **Performance** tab -> Click **CPU**.
   - Ensure **Virtualization: Enabled** is shown. (If disabled, turn it on in your BIOS/UEFI settings).
2. **Install WSL 2 (Windows Subsystem for Linux)**:
   - Open PowerShell or Command Prompt as Administrator and run:
     ```powershell
     wsl --install
     ```
   - Restart your PC if prompted.
3. **Install Docker Desktop**:
   - Download the official installer from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/).
   - Run the installer. By default, **"Use WSL 2 instead of Hyper-V"** is recommended.
   - Once installed, launch **Docker Desktop** from the Start Menu.
   - Verify in PowerShell:
     ```powershell
     docker --version
     docker compose version
     ```

#### (Alternative) Using Hyper-V Instead of WSL 2 on Windows
If your Windows edition is **Windows 10/11 Pro, Enterprise, or Education** and you prefer using **Hyper-V**:
1. **Enable Hyper-V**:
   - Open PowerShell as Administrator and run:
     ```powershell
     Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
     ```
   - Type `Y` and restart your PC.
2. **Switch Docker Desktop to Hyper-V**:
   - In Docker Desktop, click **Settings (gear icon)** -> **General**.
   - **Uncheck** `Use the WSL 2 based engine` (this switches Docker to Hyper-V mode).
   - Click **Apply & restart**.
*(Note: Windows Home does not support Hyper-V, so Windows Home users must use WSL 2).*

### macOS Installation
1. Download Docker Desktop for Mac from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) (select **Apple Silicon** for M1/M2/M3/M4 or **Intel** for older Macs).
2. Drag `Docker.app` into your Applications folder and launch it.
3. Verify in Terminal:
   ```bash
   docker --version
   docker compose version
   ```

### Linux Installation (Ubuntu / Debian)
Run the following in your terminal:
```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```
*(Log out and log back in for user group changes to take effect).*

---

## 2. Building & Running Arix AI on Your Machine

The repository already comes pre-configured with a multi-runtime [`Dockerfile`](file:///e:/Coding%20World/Arix-AI/Dockerfile) (Python 3.11 + Node.js 20) and [`docker-compose.yml`](file:///e:/Coding%20World/Arix-AI/docker-compose.yml).

### Option A: Using Docker Compose (Recommended)

1. Open PowerShell or Terminal in the root `Arix-AI` directory:
   ```powershell
   cd "e:\Coding World\Arix-AI"
   ```
2. Build and start the container:
   ```bash
   docker compose up --build
   ```
3. Open your browser and navigate to:
   - **Frontend Web UI**: [http://localhost:5173](http://localhost:5173)
   - **Backend API & Health**: [http://localhost:8765/health](http://localhost:8765/health)

To run it in the background (detached mode):
```bash
docker compose up -d
```
To stop it:
```bash
docker compose down
```

---

### Option B: Using Standard Docker CLI

1. **Build the image**:
   ```bash
   docker build -t arix-ai:latest .
   ```
2. **Run the container**:
   ```bash
   docker run -d \
     --name arix-ai-app \
     -p 5173:5173 \
     -p 8765:8765 \
     arix-ai:latest
   ```
3. View the logs:
   ```bash
   docker logs -f arix-ai-app
   ```
4. Stop or start the container:
   ```bash
   docker stop arix-ai-app
   docker start arix-ai-app
   ```

---

## 3. How to Send the Docker Container to Your Friend

You have **3 easy ways** to share this project with your friend:

### Method 1: Export as a Single `.tar` File (Offline / Drive)
> **Best if your friend does not want to install Node/Python or build from scratch.** You give them one ready-to-run package!

1. Save the built image to a `.tar` archive:
   ```powershell
   # PowerShell / Command Prompt:
   docker save arix-ai:latest -o arix-ai.tar
   ```
   *(Optional for smaller file size: compress it with 7-Zip or run `tar -czvf arix-ai.tar.gz arix-ai.tar`).*

2. **Send `arix-ai.tar` to your friend**:
   - Transfer via USB Pendrive, External SSD, Google Drive, OneDrive, or WeTransfer.

---

### Method 2: Send Project ZIP / Git Repository
> **Best if your friend is a developer and wants the source files right away.**

1. Compress the project folder into a `.zip` file, **excluding** heavy folders:
   - Do **NOT** include `.venv/` or `node_modules/` or `frontend/dist/` (Docker will build them automatically).
2. Send the `.zip` file (or push the repository to GitHub and give your friend the repo link).
3. Your friend simply extracts the ZIP and runs:
   ```bash
   docker compose up --build
   ```

---

### Method 3: Publish to Docker Hub (Cloud Registry)
> **Best if you want your friend to download it anywhere with a single command.**

1. Create a free account at [hub.docker.com](https://hub.docker.com/).
2. Log in on your terminal:
   ```bash
   docker login
   ```
3. Tag and push your image:
   ```bash
   docker tag arix-ai:latest YOUR_DOCKERHUB_USERNAME/arix-ai:latest
   docker push YOUR_DOCKERHUB_USERNAME/arix-ai:latest
   ```
4. Your friend can run it on their machine with:
   ```bash
   docker run -d -p 5173:5173 -p 8765:8765 YOUR_DOCKERHUB_USERNAME/arix-ai:latest
   ```

---

## 4. How Your Friend Runs It on Their Computer

Send these exact steps to your friend:

1. **Install Docker Desktop** on your computer (see [Section 1](#1-prerequisites--installing-docker)).
2. Place the `arix-ai.tar` file in a folder (for example, `C:\ArixAI` or `~/Downloads`).
3. Open PowerShell or Terminal in that folder and load the image:
   ```bash
   docker load -i arix-ai.tar
   ```
   You will see: `Loaded image: arix-ai:latest`
4. Run the container:
   ```bash
   docker run -d --name arix-ai-app -p 5173:5173 -p 8765:8765 arix-ai:latest
   ```
5. Open your web browser (Chrome, Edge, or Firefox) and go to:
   **[http://localhost:5173](http://localhost:5173)**
6. In the Arix AI interface, open **Settings** (gear icon) and enter your Gemini API key (or configure your voice/theme preferences).
7. When done, stop it anytime with:
   ```bash
   docker stop arix-ai-app
   ```
   And restart it later with:
   ```bash
   docker start arix-ai-app
   ```

---

## 5. How to Take All Files Out of the Container to Make Changes

If your friend only has the Docker container/image and wants to **extract the full source code**, make modifications, and see their changes:

### Approach 1: Extract the Source Code from the Container (`docker cp`)

This pulls the exact project directory out of the Docker container onto their computer:

1. Create a container instance (without needing to run it):
   ```bash
   docker create --name arix-extractor arix-ai:latest
   ```
2. Copy the entire `/app` directory to a folder on the host machine:
   ```bash
   # Copies files into a new folder named 'arix-code':
   docker cp arix-extractor:/app ./arix-code
   ```
3. Remove the temporary extractor container:
   ```bash
   docker rm arix-extractor
   ```
4. **All project files are now in `./arix-code`!**
   Your friend can now open `./arix-code` in **VS Code**, PyCharm, or any editor, edit Python files, edit React/TypeScript files, or inspect the codebase.

---

### Approach 2: Live Code Editing with Volume Mounting (Bind Mounts)
> **The Best Developer Workflow:** Changes made on the host machine in VS Code instantly take effect inside the running container **without rebuilding**!

1. Open PowerShell / Terminal inside the extracted project folder (`cd arix-code`).
2. Run the container with **bind mounts** for backend and frontend source:

   **On Windows (PowerShell):**
   ```powershell
   docker run -it --rm `
     -p 5173:5173 `
     -p 8765:8765 `
     -v "${PWD}/backend:/app/backend" `
     -v "${PWD}/frontend/src:/app/frontend/src" `
     --name arix-dev `
     arix-ai:latest
   ```

   **On Mac / Linux (Bash):**
   ```bash
   docker run -it --rm \
     -p 5173:5173 \
     -p 8765:8765 \
     -v "$(pwd)/backend:/app/backend" \
     -v "$(pwd)/frontend/src:/app/frontend/src" \
     --name arix-dev \
     arix-ai:latest
   ```

   **Or simply using Docker Compose:**
   Open `docker-compose.yml` and uncomment lines 18–19:
   ```yaml
   volumes:
     - arix_data:/app/backend/data
     - ./backend:/app/backend
     - ./frontend/src:/app/frontend/src
   ```
   Then run:
   ```bash
   docker compose up
   ```
3. **Now, whenever your friend edits any `.py` or `.tsx` file, FastAPI and Vite will automatically reload with the changes live!**

---

### Approach 3: Rebuilding the Container After Editing

If your friend modifies `requirements.txt`, installs new npm packages, or wants to bake their changes into a new standalone image:

1. Rebuild the image:
   ```bash
   docker build -t arix-ai:latest .
   ```
   *(or `docker compose up --build`)*
2. Run the updated container:
   ```bash
   docker run -d -p 5173:5173 -p 8765:8765 arix-ai:latest
   ```
3. To share their updated version back to you:
   ```bash
   docker save arix-ai:latest -o arix-ai-updated.tar
   ```

---

## 6. Accessing Microphone & Voice in the Browser

Because Arix AI is a voice-first assistant:

1. When opening **[http://localhost:5173](http://localhost:5173)** in Google Chrome, Microsoft Edge, or Firefox, the browser will display a permission prompt:
   > *"localhost wants to use your microphone: [Allow] / [Block]"*
2. Click **Allow**.
3. Modern desktop browsers treat `http://localhost` and `http://127.0.0.1` as **secure origins**, so full Web Audio and MediaStream microphone features work out of the box without requiring SSL certificates.
4. You can adjust your microphone volume, input device, and speaker output device directly in the controls next to the **Start Voice Session** button on the home screen.

---

## 7. Helpful Docker Commands Cheat Sheet

| Action | Command |
|---|---|
| **View running containers** | `docker ps` |
| **View all containers (including stopped)** | `docker ps -a` |
| **View live logs of Arix AI** | `docker logs -f arix-ai-app` |
| **Stop container** | `docker stop arix-ai-app` |
| **Start container** | `docker start arix-ai-app` |
| **Restart container** | `docker restart arix-ai-app` |
| **Open an interactive terminal inside the container** | `docker exec -it arix-ai-app bash` |
| **Copy a file into the container** | `docker cp ./my-file.txt arix-ai-app:/app/` |
| **Copy a file out of the container** | `docker cp arix-ai-app:/app/backend/data/config.json ./config.json` |
| **Delete the container** | `docker rm -f arix-ai-app` |
| **Delete the image** | `docker rmi arix-ai:latest` |
| **Prune unused docker resources** | `docker system prune` |

---

## 8. Troubleshooting & FAQs

### Q1: `bind: address already in use` (Port 5173 or 8765 error)
* **Cause**: Another instance of Arix AI, Vite, or Python is already running on port `5173` or `8765` on your machine.
* **Fix**:
  - Close any running local terminal running `npm run dev`.
  - On Windows, check what is using the port:
    ```powershell
    netstat -ano | findstr :8765
    netstat -ano | findstr :5173
    ```
  - Or map the container to different host ports:
    ```bash
    docker run -d -p 5174:5173 -p 8766:8765 arix-ai:latest
    ```
    Then access via `http://localhost:5174`.

### Q2: Docker command not recognized
* **Cause**: Docker Desktop is not installed, or has not been added to your system PATH, or is not running.
* **Fix**: Launch **Docker Desktop** from the Start Menu / Applications folder. Wait until the whale icon in the taskbar turns solid and reports "Docker Desktop is running".

### Q3: How are my settings and memories saved across Docker restarts?
* In `docker-compose.yml`, the named volume `arix_data:/app/backend/data` is mounted to the container's storage. All your saved configurations, memory graphs, and custom project records persist even when the container is stopped or upgraded.

### Q4: Desktop-level mouse/keyboard automation inside Docker?
* The web app, chat, plans, tasks, memory systems, coding tools, and full Gemini 3.8 Live voice conversation run completely inside Docker.
* Operating system desktop automation (`pyautogui` clicks outside the browser on the host OS desktop) requires host display bindings if run from Linux containers; on native Windows/Mac hosts, use the local native electron runner (`npm run dev`) if host-wide OS cursor control is desired.

---

**You are all set! Share `arix-ai.tar` (or the repository) along with this `DOCKER_GUIDE.md` with your friend to get them up and running immediately.**
