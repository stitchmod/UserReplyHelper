/**
 * User Reply Helper — SillyTavern Extension
 * Generates a suggested user reply based on the last character message.
 */

const MODULE_NAME = 'user_reply_helper';

const defaultSettings = Object.freeze({
    enabled: true,
    customSystemPrompt: '',
    insertMode: 'insert',
    language: 'auto',
});

// ─── Settings ────────────────────────────────────────────────────────────────

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
    SillyTavern.getContext().saveSettingsDebounced();
}

// ─── Think-tag stripping ──────────────────────────────────────────────────────

/**
 * Strip reasoning blocks from model output.
 * Handles Qwen3 (<think>), DeepSeek-R1 (<think>), QwQ, and partial/unclosed tags.
 */
function stripThinkingBlocks(text) {
    if (!text) return text;

    // Remove complete blocks
    let r = text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

    // Remove unclosed opening tag + everything after
    r = r
        .replace(/<think>[\s\S]*/gi, '')
        .replace(/<thinking>[\s\S]*/gi, '');

    // Remove orphaned closing tag + everything before (got only the tail)
    r = r
        .replace(/[\s\S]*<\/think>/gi, '')
        .replace(/[\s\S]*<\/thinking>/gi, '');

    return r.trim();
}

// ─── Prompt building ──────────────────────────────────────────────────────────

function buildChatContext(chat, maxMessages = 12) {
    return chat.slice(-maxMessages)
        .map(m => `[${m.is_user ? 'User' : (m.name || 'Character')}]: ${m.mes}`)
        .join('\n');
}

function getCurrentCharacterName() {
    const ctx = SillyTavern.getContext();
    if (ctx.groupId) {
        const last = [...ctx.chat].reverse().find(m => !m.is_user);
        return last?.name || 'Character';
    }
    return ctx.characters[ctx.characterId]?.name || 'Character';
}

/**
 * System prompt strategy:
 * 1. /no_think on line 1 — Qwen3 soft-switch (works in system prompt)
 * 2. Role definition as ghostwriter, NOT as character
 * 3. Prohibitions listed BEFORE instructions (early-token weighting)
 * 4. Concrete right/wrong output examples
 */
function buildSystemPrompt(settings, characterName) {
    const langLine = settings.language === 'ru'
        ? '\nWrite the reply in Russian.'
        : settings.language === 'en'
            ? '\nWrite the reply in English.'
            : '';

    const custom = settings.customSystemPrompt
        ? `\n\nAdditional style instructions:\n${settings.customSystemPrompt}`
        : '';

    return `/no_think
You are a ghostwriter helping a human compose their next message in a roleplay chat.

YOUR ONLY JOB:
Write the next message FROM THE HUMAN/USER's perspective — one short, natural reply.

ABSOLUTE PROHIBITIONS:
- DO NOT write as ${characterName} or continue ${characterName}'s lines.
- DO NOT produce <think>, <thinking>, or any XML/reasoning tags whatsoever.
- DO NOT add a speaker label or prefix (no "User:", "Me:", "Reply:", "[User]:").
- DO NOT write more than one message or add narration/stage directions.
- DO NOT explain what you are doing. DO NOT comment on the task.
- DO NOT output anything except the reply text itself.

CORRECT output examples:
  Хм, ты правда так думаешь? Мне интересно почему.
  That's a strange thing to say. Tell me more.

WRONG output examples:
  [User]: Хм, ты правда...          ← has a label
  <think>Let me think...</think> Hmm  ← has a think block
  ${characterName}: продолжает...    ← writing as the character
${langLine}${custom}`;
}

// ─── Core generation ──────────────────────────────────────────────────────────

async function generateUserReply() {
    const ctx = SillyTavern.getContext();
    const { chat, generateRaw } = ctx;
    const settings = getSettings();

    if (!chat || chat.length === 0) {
        toastr.warning('No chat history found.');
        return;
    }
    const lastCharMsg = [...chat].reverse().find(m => !m.is_user);
    if (!lastCharMsg) {
        toastr.warning('No character message to reply to yet.');
        return;
    }

    const characterName = getCurrentCharacterName();
    const systemPrompt = buildSystemPrompt(settings, characterName);
    const chatContext = buildChatContext(chat);

    // Short imperative user-turn — reasoning models degrade with verbose prompts
    const userPrompt =
        `Conversation so far:\n\n${chatContext}\n\n` +
        `Write the User's next reply to ${characterName}'s last message. ` +
        `Output the reply text only — no labels, no tags, nothing else.`;

    const btn = document.getElementById('urh_generate_btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
        let result = await generateRaw({ systemPrompt, prompt: userPrompt });

        if (!result || !result.trim()) {
            toastr.error('Model returned an empty reply. Try again.');
            return;
        }

        // Strip think blocks — always, unconditionally
        result = stripThinkingBlocks(result);

        // Strip stubborn speaker labels
        result = result
            .replace(/^\[?User\]?:\s*/i, '')
            .replace(/^\[?Пользователь\]?:\s*/iu, '')
            .replace(/^\[?Me\]?:\s*/i, '')
            .trim();

        if (!result) {
            toastr.error('Output was empty after cleanup. Try again.');
            return;
        }

        if (settings.insertMode === 'confirm') {
            const { Popup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
            const popup = new Popup(
                `<div style="white-space:pre-wrap;padding:10px;line-height:1.6;">${escapeHtml(result)}</div>`,
                POPUP_TYPE.CONFIRM,
                '',
                { okButton: '✓ Use this reply', cancelButton: 'Discard' }
            );
            if (await popup.show() === POPUP_RESULT.AFFIRMATIVE) {
                insertIntoTextarea(result);
            }
        } else {
            insertIntoTextarea(result);
        }

    } catch (err) {
        console.error(`[${MODULE_NAME}]`, err);
        toastr.error('Generation failed. Check the browser console.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-reply"></i>';
        }
    }
}

function insertIntoTextarea(text) {
    const ta = document.getElementById('send_textarea');
    if (!ta) return;
    ta.value = ta.value ? `${ta.value}\n${text}` : text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── UI: send-bar button ──────────────────────────────────────────────────────

function injectButton() {
    if (document.getElementById('urh_generate_btn')) return;

    const btn = document.createElement('div');
    btn.id = 'urh_generate_btn';
    btn.className = 'urh-btn interactable';
    btn.title = 'Generate user reply suggestion (User Reply Helper)';
    btn.innerHTML = '<i class="fa-solid fa-reply"></i>';
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('role', 'button');

    btn.addEventListener('click', () => {
        if (!getSettings().enabled) {
            toastr.info('User Reply Helper is disabled. Enable it in Extensions settings.');
            return;
        }
        generateUserReply();
    });

    btn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
    });

    const sendBtn = document.getElementById('send_but');
    if (sendBtn?.parentNode) {
        sendBtn.parentNode.insertBefore(btn, sendBtn);
    } else {
        document.getElementById('send_form')?.appendChild(btn);
    }
}

// ─── UI: settings panel ──────────────────────────────────────────────────────

function buildSettingsPanel() {
    const s = getSettings();
    const html = `
<div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>User Reply Helper</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
        <div class="urh-row">
            <label class="checkbox_label">
                <input id="urh_enabled" type="checkbox" ${s.enabled ? 'checked' : ''} />
                <span>Enable extension</span>
            </label>
        </div>
        <div class="urh-row">
            <label for="urh_insert_mode">After generation:</label>
            <select id="urh_insert_mode" class="text_pole">
                <option value="insert"  ${s.insertMode === 'insert'  ? 'selected' : ''}>Insert directly into input</option>
                <option value="confirm" ${s.insertMode === 'confirm' ? 'selected' : ''}>Show preview, confirm before inserting</option>
            </select>
        </div>
        <div class="urh-row">
            <label for="urh_language">Reply language:</label>
            <select id="urh_language" class="text_pole">
                <option value="auto" ${s.language === 'auto' ? 'selected' : ''}>Auto (match conversation)</option>
                <option value="en"   ${s.language === 'en'   ? 'selected' : ''}>English</option>
                <option value="ru"   ${s.language === 'ru'   ? 'selected' : ''}>Русский</option>
            </select>
        </div>
        <div class="urh-row">
            <label for="urh_custom_prompt">Custom style instructions <small>(optional)</small>:</label>
            <textarea id="urh_custom_prompt" class="text_pole" rows="3"
                placeholder="e.g. Keep replies short and sarcastic. Never use exclamation marks."
            >${s.customSystemPrompt}</textarea>
        </div>
        <div class="urh-hint">
            <i class="fa-solid fa-circle-info"></i>
            Qwen3: <code>/no_think</code> is injected automatically.<br>
            DeepSeek-R1 &amp; others: <code>&lt;think&gt;</code> blocks are always stripped from output.
        </div>
    </div>
</div>`;

    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.getElementById('extensions_settings2')?.appendChild(wrap);

    document.getElementById('urh_enabled')?.addEventListener('change', e => {
        getSettings().enabled = e.target.checked; saveSettings();
    });
    document.getElementById('urh_insert_mode')?.addEventListener('change', e => {
        getSettings().insertMode = e.target.value; saveSettings();
    });
    document.getElementById('urh_language')?.addEventListener('change', e => {
        getSettings().language = e.target.value; saveSettings();
    });
    document.getElementById('urh_custom_prompt')?.addEventListener('input', e => {
        getSettings().customSystemPrompt = e.target.value; saveSettings();
    });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export async function onActivate() {
    console.log(`[${MODULE_NAME}] Activated.`);
    getSettings();
}

(async () => {
    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.on(event_types.APP_READY, () => {
        console.log(`[${MODULE_NAME}] Injecting UI...`);
        injectButton();
        buildSettingsPanel();
    });
})();
