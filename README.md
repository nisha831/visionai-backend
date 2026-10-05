
# 1. README — How a new user runs the project

Your README should **not** use:

```bash
cd ~/Desktop/hahaha/...
```

because that path exists only on your Mac.

For a new user, use this:

```markdown
# 🚀 How to Run VisionAI

## 1. Clone the Repository

```bash
git clone https://github.com/nisha831/visionai-backend.git
cd visionai-backend
```

The repository contains:

```text
visionai-backend/
├── VisionAI/
├── Raspi-backend/
├── visionai-backend/
├── backend/
├── docs/
├── images/
├── notes/
└── tests/
```

---

## 2. Start the FastAPI Backend

Open Terminal 1.

From the repository root:

```bash
cd visionai-backend
```

Create a Python virtual environment:

```bash
python3 -m venv venv
```

Activate it:

### macOS / Linux

```bash
source venv/bin/activate
```

### Windows

```bash
venv\Scripts\activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the FastAPI server:

```bash
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

The backend will be available at:

```text
http://localhost:8000
```

FastAPI documentation:

```text
http://localhost:8000/docs
```

---

## 3. Run the VisionAI Mobile Application

Open Terminal 2.

From the repository root:

```bash
cd VisionAI
```

Install Node dependencies:

```bash
npm install
```

Start Expo:

```bash
npx expo start
```

For a clean start:

```bash
npx expo start -c
```

A QR code will appear.

Install **Expo Go** on your Android/iOS phone and scan the QR code.

Make sure the phone and computer are connected to the same network.

---

## 4. Run the Raspberry Pi Backend

The Raspberry Pi must have the `Raspi-backend` folder.

SSH into the Raspberry Pi:

```bash
ssh kanchannish08@RasberryPi5.local
```

Go to the backend:

```bash
cd ~/Raspi-backend
```

Create the virtual environment if required:

```bash
python3 -m venv --system-site-packages venv
```

Activate it:

```bash
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the Raspberry Pi controller:

```bash
python3 -m raspberry_pi.pi_main
```

The Raspberry Pi controller handles:

- Raspberry Pi camera
- Physical button
- HC-SR04 distance sensor
- Communication with the FastAPI backend

---

# 🔄 Complete Startup

Run the following three components.

### Terminal 1 — FastAPI

```bash
cd visionai-backend
source venv/bin/activate
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### Terminal 2 — Mobile App

```bash
cd VisionAI
npx expo start -c
```

Scan the QR code using Expo Go.

### Raspberry Pi

```bash
ssh kanchannish08@RasberryPi5.local
cd ~/Raspi-backend
source venv/bin/activate
python3 -m raspberry_pi.pi_main
```

---

# 🌐 Network Configuration

For mobile and Raspberry Pi communication, the devices must be able to reach the computer running FastAPI.

Find your computer's local IP address.

### macOS

```bash
ipconfig getifaddr en0
```

Example:

```text
10.65.74.68
```

The backend can then be accessed using:

```text
http://10.65.74.68:8000
```

Test it from a phone browser:

```text
http://YOUR-COMPUTER-IP:8000
```

FastAPI documentation:

```text
http://YOUR-COMPUTER-IP:8000/docs
```

> Replace `YOUR-COMPUTER-IP` with the current IP address of the computer running the backend.

---

# 📷 Raspberry Pi Camera Test

On the Raspberry Pi:

```bash
rpicam-hello
```

Capture a test image:

```bash
rpicam-still -o test.jpg
```

Or:

```bash
rpicam-still --nopreview -o test.jpg --width 640 --height 480
```

---

# 🧪 Hardware Tests

### Test Camera

```bash
python3 test_camera.py
```

### Test Distance Sensor

```bash
python3 test_sensor.py
```

### Test Button

```bash
python3 test_button.py
```

---

# 🛑 Stop the Services

Press:

```text
Ctrl + C
```

in the terminal running the respective service.
```

### One important thing

Your screenshot shows both:

```text
Raspi-backend/
VisionAI/
visionai-backend/
```

and also:

```text
backend/
images/
docs/
notes/
tests/
```

at the repository root.

So **before publishing the README, I would keep the commands based on the actual root structure shown in your GitHub**, rather than assuming `visionai-backend` is the only backend directory.

---

# 2. Why only `nisha831` appears as Contributor?

This is the important part.

Your screenshot shows:

> **Contributors 1 — nisha831**

even though your commit was:

> `Update VisionAI, Raspberry Pi and backend`

That does **not necessarily mean your commit wasn't pushed**.

GitHub determines contributors based largely on the **author email attached to Git commits**.

Your local Git may currently be configured with an email that GitHub doesn't associate with your account.

### Check your commit identity

Run:

```bash
cd ~/Desktop/hahaha
git log -1 --format='%an <%ae>'
```

You'll get something like:

```text
kanchannishad <something@gmail.com>
```

Then check:

```bash
git config user.name
git config user.email
```

### If the email isn't connected to your GitHub account

Go to:

**GitHub → Profile → Settings → Emails**

and check whether the email shown by:

```bash
git config user.email
```

is added and verified on **your GitHub account**.

If it isn't, add and verify it.

---

## Better option for future commits

You can configure Git to use your GitHub email:

```bash
git config --global user.name "Kanchan Nishad"
```

Then:

```bash
git config --global user.email "YOUR_GITHUB_EMAIL"
```

Check:

```bash
git config --global --list
```

### If you use GitHub's private noreply email

You can also use your GitHub-provided:

```text
xxxx+username@users.noreply.github.com
```

instead of your personal email.

---

### What about the commit you already made?

Don't make another commit yet.

First run:

```bash
git log --format='%h %an <%ae> %s' -5
```

