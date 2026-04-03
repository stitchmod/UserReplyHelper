/**
 * User Reply Helper — SillyTavern Extension
 * Generates a suggested user reply based on the last character message.
 */

const MODULE_NAME = 'user_reply_helper';

const defaultSettings = Object.freeze({
    enabled: true,
    customSystemPrompt: '',
    insertMode: 'insert', // 'insert' | 'confirm'
    language: 'auto',    // 'auto' | 'en' | 'ru' | etc.
    maxTokens: 200,
});

// ─── Settings helpers ────────────────────────────────────────────────────────

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    return extensionSettings[MODULE_NAME];
}

function saveSettings() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    saveSettingsDebounced();
}

// ─── Core logic ──────────────────────────────────────────────────────────────

/**
 * Build the last N messages of chat history as a readable string for the prompt.
 */
function buildChatContext(chat, maxMessages = 10) {
    const recent = chat.slice(-maxMessages);
    return recent
        .map(m => {
            const speaker = m.is_user ? 'User' : (m.name || 'Character');
            return `${speaker}: ${m.mes}`;
        })
        .join('\n');
}

/**
 * Build the system prompt that forces the model to produce ONLY a user reply.
 */
function buildSystemPrompt(settings, characterName) {
    const langInstruction = (() => {
        if (settings.language === 'auto') return '';
        if (settings.language === 'ru') return ' Reply in Russian.';
        if (settings.language === 'en') return ' Reply in English.';
        return ` Reply in ${settings.language}.`;
    })();

    const custom = settings.customSystemPrompt ? `\n\n${settings.customSystemPrompt}` : '';

    return (
        `You are a writing assistant helping the USER compose their next message in an ongoing roleplay conversation with a character named "${characterName || 'the character'}".\n\n` +
        `YOUR TASK:\n` +
        `Write ONLY the user's next reply — a single, in-character message from the user's perspective.\n\n` +
        `STRICT RULES:\n` +
        `- Output ONLY the reply text. No explanations, no labels, no quotes, no preamble.\n` +
        `- Do NOT write as the character. Do NOT continue the character's dialogue.\n` +
        `- Do NOT add stage directions, actions, or narration unless the user's style already uses them.\n` +
        `- Do NOT start with "User:", "Me:", or any prefix.\n` +
        `- Keep the reply natural and consistent with the user's tone in the conversation.` +
        langInstruction +
        custom
    );
}

/**
 * Get the name of the current character (handles groups too).
 */
function getCurrentCharacterName() {
    const context = SillyTavern.getContext();
    if (context.groupId) {
        // In a group, find the last character who spoke
        const lastCharMsg = [...context.chat].reverse().find(m => !m.is_user);
        return lastCharMsg?.name || 'the character';
    }
    return context.characters[context.characterId]?.name || 'the character';
}

/**
 * Main generation function.
 */
async function generateUserReply() {
    const context = SillyTavern.getContext();
    const { chat, generateRaw } = context;
    const settings = getSettings();

    if (!chat || chat.length === 0) {
        toastr.warning('No chat history found.');
        return;
    }

    // Find the last character message
    const lastCharMsg = [...chat].reverse().find(m => !m.is_user);
    if (!lastCharMsg) {
        toastr.warning('No character message found to reply to.');
        return;
    }

    const characterName = getCurrentCharacterName();
    const systemPrompt = buildSystemPrompt(settings, characterName);
    const chatContext = buildChatContext(chat);

    const userPrompt =
        `Here is the recent conversation:\n\n${chatContext}\n\n` +
        `Now write the user's next reply to ${characterName}'s last message. ` +
        `Output ONLY the reply text — nothing else.`;

    // Show spinner on the button
    const btn = document.getElementById('urh_generate_btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
        const result = await generateRaw({
            systemPrompt,
            prompt: userPrompt,
        });

        if (!result || !result.trim()) {
            toastr.error('Model returned an empty reply. Try again.');
            return;
        }

        const cleaned = result.trim();

        if (settings.insertMode === 'confirm') {
            const { Popup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
            const popup = new Popup(
                `<div style="white-space:pre-wrap; padding:8px;">${escapeHtml(cleaned)}</div>`,
                POPUP_TYPE.CONFIRM,
                '',
                { okButton: 'Use this reply', cancelButton: 'Discard' }
            );
            const res = await popup.show();
            if (res === POPUP_RESULT.AFFIRMATIVE) {
                insertIntoTextarea(cleaned);
            }
        } else {
            insertIntoTextarea(cleaned);
        }

    } catch (err) {
        console.error(`[${MODULE_NAME}] Generation error:`, err);
        toastr.error('Failed to generate reply. Check console for details.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-reply"></i>';
        }
    }
}

/**
 * Insert text into the send textarea, triggering proper events.
 */
function insertIntoTextarea(text) {
    const textarea = document.getElementById('send_textarea');
    if (!textarea) return;

    const current = textarea.value;
    textarea.value = current ? `${current}\n${text}` : text;

    // Trigger input event so ST updates its internal state (char counter, etc.)
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
}

/**
 * Simple HTML escape to prevent XSS in popup preview.
 */
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── UI: button in send bar ──────────────────────────────────────────────────

function injectButton() {
    if (document.getElementById('urh_generate_btn')) return; // already injected

    const btn = document.createElement('div');
    btn.id = 'urh_generate_btn';
    btn.className = 'urh-btn interactable';
    btn.title = 'Generate user reply suggestion';
    btn.innerHTML = '<i class="fa-solid fa-reply"></i>';
    btn.setAttribute('tabindex', '0');

    btn.addEventListener('click', () => {
        const settings = getSettings();
        if (!settings.enabled) {
            toastr.info('User Reply Helper is disabled.');
            return;
        }
        generateUserReply();
    });

    // Keyboard accessibility
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            btn.click();
        }
    });

    // Insert before the send button
    const sendBtn = document.getElementById('send_but');
    if (sendBtn && sendBtn.parentNode) {
        sendBtn.parentNode.insertBefore(btn, sendBtn);
    } else {
        // Fallback: append to send_form
        const form = document.getElementById('send_form');
        if (form) form.appendChild(btn);
    }
}

// ─── UI: settings panel ──────────────────────────────────────────────────────

function buildSettingsPanel() {
    const settings = getSettings();

    const html = `
<div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>User Reply Helper</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">

        <div class="urh-row">
            <label class="checkbox_label">
                <input id="urh_enabled" type="checkbox" ${settings.enabled ? 'checked' : ''} />
                <span>Enable extension</span>
            </label>
        </div>

        <div class="urh-row">
            <label for="urh_insert_mode">After generation:</label>
            <select id="urh_insert_mode" class="text_pole">
                <option value="insert" ${settings.insertMode === 'insert' ? 'selected' : ''}>Insert directly into input</option>
                <option value="confirm" ${settings.insertMode === 'confirm' ? 'selected' : ''}>Show preview, ask confirmation</option>
            </select>
        </div>

        <div class="urh-row">
            <label for="urh_language">Reply language:</label>
            <select id="urh_language" class="text_pole">
                <option value="auto" ${settings.language === 'auto' ? 'selected' : ''}>Auto (match conversation)</option>
                <option value="en" ${settings.language === 'en' ? 'selected' : ''}>English</option>
                <option value="ru" ${settings.language === 'ru' ? 'selected' : ''}>Русский</option>
            </select>
        </div>

        <div class="urh-row">
            <label for="urh_custom_prompt">Custom instructions for the model <small>(optional)</small>:</label>
            <textarea id="urh_custom_prompt" class="text_pole" rows="3" placeholder="e.g. Keep replies short and sarcastic.">${settings.customSystemPrompt}</textarea>
        </div>

        <div class="urh-hint">
            <i class="fa-solid fa-circle-info"></i>
            The model is strictly instructed to output <em>only</em> the user's reply text — no labels, no character lines, no preamble.
        </div>

    </div>
</div>`;

    const container = document.createElement('div');
    container.innerHTML = html;
    document.getElementById('extensions_settings2')?.appendChild(container);

    // Wire events
    document.getElementById('urh_enabled')?.addEventListener('change', e => {
        getSettings().enabled = e.target.checked;
        saveSettings();
    });

    document.getElementById('urh_insert_mode')?.addEventListener('change', e => {
        getSettings().insertMode = e.target.value;
        saveSettings();
    });

    document.getElementById('urh_language')?.addEventListener('change', e => {
        getSettings().language = e.target.value;
        saveSettings();
    });

    document.getElementById('urh_custom_prompt')?.addEventListener('input', e => {
        getSettings().customSystemPrompt = e.target.value;
        saveSettings();
    });
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export async function onActivate() {
    console.log(`[${MODULE_NAME}] Activating...`);
    getSettings(); // initialize defaults
}

(async () => {
    const { eventSource, event_types } = SillyTavern.getContext();

    // Wait for the app to be fully ready
    eventSource.on(event_types.APP_READY, async () => {
        console.log(`[${MODULE_NAME}] App ready, injecting UI...`);
        injectButton();
        buildSettingsPanel();
    });
})();
