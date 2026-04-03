/**
 * User Reply Helper — SillyTavern Extension
 * Generates suggested user reply and chat summary.
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

function stripThinkingBlocks(text) {
    if (!text) return text;
    let r = text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    r = r
        .replace(/<think>[\s\S]*/gi, '')
        .replace(/<thinking>[\s\S]*/gi, '');
    r = r
        .replace(/[\s\S]*<\/think>/gi, '')
        .replace(/[\s\S]*<\/thinking>/gi, '');
    return r.trim();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function setButtonLoading(id, loading) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = loading;
    if (id === 'urh_reply_btn') {
        btn.innerHTML = loading
            ? '<i class="fa-solid fa-spinner fa-spin"></i>'
            : '<i class="fa-solid fa-reply"></i>';
    } else {
        btn.innerHTML = loading
            ? '<i class="fa-solid fa-spinner fa-spin"></i>'
            : '<i class="fa-solid fa-scroll"></i>';
    }
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function insertIntoTextarea(text) {
    const ta = document.getElementById('send_textarea');
    if (!ta) return;
    ta.value = ta.value ? `${ta.value}\n${text}` : text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
}

// ─── Reply generation ─────────────────────────────────────────────────────────

function buildReplySystemPrompt(settings, characterName) {
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
  [User]: Хм, ты правда...          <- has a label
  <think>Let me think...</think> Hmm <- has a think block
  ${characterName}: продолжает...   <- writing as the character
${langLine}${custom}`;
}

async function generateUserReply() {
    const ctx = SillyTavern.getContext();
    const { chat, generateRaw } = ctx;
    const settings = getSettings();

    if (!chat || chat.length === 0) { toastr.warning('No chat history found.'); return; }
    const lastCharMsg = [...chat].reverse().find(m => !m.is_user);
    if (!lastCharMsg) { toastr.warning('No character message to reply to yet.'); return; }

    const characterName = getCurrentCharacterName();
    const systemPrompt = buildReplySystemPrompt(settings, characterName);
    const chatContext = buildChatContext(chat);
    const userPrompt =
        `Conversation so far:\n\n${chatContext}\n\n` +
        `Write the User's next reply to ${characterName}'s last message. ` +
        `Output the reply text only — no labels, no tags, nothing else.`;

    setButtonLoading('urh_reply_btn', true);
    try {
        let result = await generateRaw({ systemPrompt, prompt: userPrompt });
        if (!result?.trim()) { toastr.error('Model returned an empty reply. Try again.'); return; }

        result = stripThinkingBlocks(result)
            .replace(/^\[?User\]?:\s*/i, '')
            .replace(/^\[?Пользователь\]?:\s*/iu, '')
            .replace(/^\[?Me\]?:\s*/i, '')
            .trim();

        if (!result) { toastr.error('Output was empty after cleanup. Try again.'); return; }

        if (settings.insertMode === 'confirm') {
            const { Popup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
            const popup = new Popup(
                `<div style="white-space:pre-wrap;padding:10px;line-height:1.6;">${escapeHtml(result)}</div>`,
                POPUP_TYPE.CONFIRM, '',
                { okButton: '✓ Use this reply', cancelButton: 'Discard' }
            );
            if (await popup.show() === POPUP_RESULT.AFFIRMATIVE) insertIntoTextarea(result);
        } else {
            insertIntoTextarea(result);
        }
    } catch (err) {
        console.error(`[${MODULE_NAME}] Reply error:`, err);
        toastr.error('Reply generation failed. Check the browser console.');
    } finally {
        setButtonLoading('urh_reply_btn', false);
    }
}

// ─── Summary generation ───────────────────────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `/no_think
You are a narrative archivist. Your job is to compress a roleplay conversation into a compact factual summary for use as context in future messages.

ABSOLUTE PROHIBITIONS:
- DO NOT continue the roleplay or write new dialogue.
- DO NOT write as any character or speak in their voice.
- DO NOT produce <think>, <thinking>, or any XML/reasoning tags.
- DO NOT add commentary, analysis, or personal opinions.
- DO NOT use first or second person ("I", "you", "we").
- DO NOT output anything except the summary text itself.

YOUR TASK:
Write a concise third-person summary of key events only — facts about what happened. No emotions, no speculation, no open threads. Just what occurred.

CORRECT output example:
  Геннадий и пользователь познакомились на форуме. Пользователь написал "это проверка". Геннадий ответил саркастично, упомянув число 13. Пользователь отправил "13" повторно.

WRONG output examples:
  <think>Let me analyze...</think> Геннадий...   <- think block
  Геннадий усмехнулся и сказал: "Ну, посмотрим..." <- продолжение RP
  The key theme here is trust...                 <- анализ/мнение

Write only the summary. No labels, no preamble, no tags.`;

async function generateSummary() {
    const ctx = SillyTavern.getContext();
    const { chat, generateRaw } = ctx;

    if (!chat || chat.length === 0) { toastr.warning('No chat history to summarize.'); return; }

    const chatContext = buildChatContext(chat, 40); // больше сообщений для суммаризации
    const userPrompt =
        `Conversation to summarize:\n\n${chatContext}\n\n` +
        `Write a concise factual summary of the key events. Output summary text only — no labels, no tags, nothing else.`;

    setButtonLoading('urh_summary_btn', true);
    try {
        let result = await generateRaw({ systemPrompt: SUMMARY_SYSTEM_PROMPT, prompt: userPrompt });
        if (!result?.trim()) { toastr.error('Model returned an empty summary. Try again.'); return; }

        result = stripThinkingBlocks(result).trim();
        if (!result) { toastr.error('Summary was empty after cleanup. Try again.'); return; }

        // Показываем popup с итогом и кнопкой копирования
        const { Popup, POPUP_TYPE } = SillyTavern.getContext();
        const summaryHtml = `
            <div style="margin-bottom:8px;font-size:12px;opacity:.6;">
                <i class="fa-solid fa-scroll"></i> Chat Summary
            </div>
            <div style="white-space:pre-wrap;padding:10px;line-height:1.6;border-left:2px solid var(--SmartThemeEmColor,#888);margin-bottom:12px;">
                ${escapeHtml(result)}
            </div>
            <div style="font-size:11px;opacity:.5;">
                Template for use: <code>[Summary: ${escapeHtml(result)}]</code>
            </div>`;

        const popup = new Popup(summaryHtml, POPUP_TYPE.TEXT, '', { okButton: 'Copy & Close' });
        await popup.show();
        // Копируем в буфер
        try {
            await navigator.clipboard.writeText(result);
            toastr.success('Summary copied to clipboard.');
        } catch {
            toastr.info('Summary shown above. Copy it manually.');
        }

    } catch (err) {
        console.error(`[${MODULE_NAME}] Summary error:`, err);
        toastr.error('Summary generation failed. Check the browser console.');
    } finally {
        setButtonLoading('urh_summary_btn', false);
    }
}

// ─── UI: кнопки в панели ввода ────────────────────────────────────────────────
//
// КЛЮЧЕВОЕ РЕШЕНИЕ бага с прыганьем чата:
// Не используем insertBefore() который нарушает DOM-порядок flexbox-контейнера.
// Вместо этого — добавляем wrapper ПОСЛЕ send_but через appendChild,
// а позиционируем его ДО кнопки Send через CSS order.
// ST использует order для позиционирования элементов в #send_form,
// send_but имеет order: 2 — ставим наш wrapper на order: 1.
// wrapper — display:contents, чтобы не создавать лишний flex-контейнер.

function injectButtons() {
    if (document.getElementById('urh_btn_wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'urh_btn_wrapper';
    // display:contents — wrapper "исчезает" как flex-элемент,
    // его дети становятся прямыми flex-детьми #send_form
    // order через CSS в style.css

    function makeBtn(id, icon, title, handler) {
        const btn = document.createElement('div');
        btn.id = id;
        btn.className = 'urh-btn interactable';
        btn.title = title;
        btn.innerHTML = `<i class="fa-solid ${icon}"></i>`;
        btn.setAttribute('tabindex', '0');
        btn.setAttribute('role', 'button');
        btn.addEventListener('click', () => {
            if (!getSettings().enabled) {
                toastr.info('User Reply Helper is disabled. Enable it in Extensions settings.');
                return;
            }
            handler();
        });
        btn.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
        });
        return btn;
    }

    wrapper.appendChild(makeBtn('urh_reply_btn',   'fa-reply',  'Generate user reply (User Reply Helper)',   generateUserReply));
    wrapper.appendChild(makeBtn('urh_summary_btn', 'fa-scroll', 'Summarize chat (User Reply Helper)',        generateSummary));

    // Добавляем в конец #send_form — позиция управляется через CSS order
    document.getElementById('send_form')?.appendChild(wrapper);
}

// ─── UI: панель настроек ──────────────────────────────────────────────────────

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
            <label for="urh_insert_mode">After reply generation:</label>
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
            <label for="urh_custom_prompt">Custom style instructions <small>(for reply, optional)</small>:</label>
            <textarea id="urh_custom_prompt" class="text_pole" rows="3"
                placeholder="e.g. Keep replies short and sarcastic. Never use exclamation marks."
            >${s.customSystemPrompt}</textarea>
        </div>
        <div class="urh-hint">
            <i class="fa-solid fa-circle-info"></i>
            <b>↩</b> — generate user reply &nbsp;|&nbsp; <b>📜</b> — summarize chat<br>
            Qwen3: <code>/no_think</code> injected automatically.
            <code>&lt;think&gt;</code> blocks always stripped.
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
        injectButtons();
        buildSettingsPanel();
    });
})();
