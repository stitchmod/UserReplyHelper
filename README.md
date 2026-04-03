# SillyTavern-UserReplyHelper

A SillyTavern extension that adds a one-click button to generate a suggested user reply based on the ongoing conversation with a character.

Inspired by the reply suggestion feature in services like Kindroid.

---

## Features

- **One-click reply suggestion** — a small button appears in the chat input bar (to the left of the Send button)
- **Strict prompt engineering** — the model is explicitly told to output *only* the user's reply text. No character lines, no labels, no preamble
- **Insert or preview** — insert the suggestion directly into the input field, or see a preview popup before accepting
- **Language control** — auto-match the conversation language, or force English / Russian
- **Custom instructions** — add your own style guidelines for the generated replies

---

## Installation

### Via SillyTavern's built-in extension manager (recommended)

1. Open SillyTavern → **Extensions** panel → **Download Extensions & Assets**
2. Paste the repository URL:
   ```
   https://github.com/your-username/SillyTavern-UserReplyHelper
   ```
3. Click **Install**

### Manual installation

1. Clone this repository into your ST `data/<user>/extensions/` folder:
   ```bash
   git clone https://github.com/your-username/SillyTavern-UserReplyHelper \
       /path/to/SillyTavern/data/default-user/extensions/SillyTavern-UserReplyHelper
   ```
2. Reload SillyTavern — the extension will appear in the Extensions panel automatically.

---

## Usage

1. Start or open a chat with any character
2. After the character sends a message, click the **↩ reply icon** button in the input bar (left of Send)
3. The model generates a suggested reply from your perspective
4. The text is inserted into the input field — edit it if you like, then send

---

## Settings

Open **Extensions → User Reply Helper** to configure:

| Setting | Description |
|---|---|
| **Enable extension** | Toggle the button on/off |
| **After generation** | Insert directly, or show a preview/confirmation popup first |
| **Reply language** | Auto (match conversation), English, or Russian |
| **Custom instructions** | Extra style notes appended to the model's system prompt |

---

## Notes on model compatibility

Some models may ignore instructions and continue the *character's* dialogue instead of writing a user reply. The extension uses a strict, unambiguous system prompt to minimize this, but results can vary by model. If you experience issues:

- Try switching to a more instruction-following model
- Add a custom instruction like: *"You are writing from the USER's point of view, not the character's."*

---

## License

AGPLv3
