/* ============================================
   NEXUSAI ADVANCED CHATBOT — SCRIPT
   Features: Streaming AI, Markdown, Code Highlight,
   Dark/Light Mode, Reactions, Regenerate, Model Switch,
   Suggested Replies, Chat Search, PDF Export, Toasts
   ============================================ */

// ============================================
// GLOBALS
// ============================================
let currentSessionId = crypto.randomUUID();
let isWebSearchEnabled = false;
let currentModel = 'gpt-oss-120b';
let lastRequestBody = null; // For regenerate
let isAtBottom = true;

// ============================================
// MARKED.JS + HIGHLIGHT.JS SETUP
// ============================================
function setupMarked() {
    if (typeof marked === 'undefined') return;

    marked.setOptions({
        breaks: true,
        gfm: true,
        highlight: function(code, lang) {
            if (typeof hljs !== 'undefined') {
                if (lang && hljs.getLanguage(lang)) {
                    return hljs.highlight(code, { language: lang }).value;
                }
                return hljs.highlightAuto(code).value;
            }
            return code;
        }
    });

    // Custom renderer for code blocks with header + copy
    const renderer = new marked.Renderer();
    renderer.code = function(code, lang) {
        const language = lang || 'code';
        let highlighted = code;
        if (typeof hljs !== 'undefined') {
            try {
                highlighted = lang && hljs.getLanguage(lang)
                    ? hljs.highlight(code, { language: lang }).value
                    : hljs.highlightAuto(code).value;
            } catch(e) {}
        }
        return `<pre><div class="code-header"><span>${language}</span><button class="copy-code-btn" onclick="copyCodeBlock(this)">Copy</button></div><code class="hljs language-${language}">${highlighted}</code></pre>`;
    };

    marked.use({ renderer });
}

// ============================================
// RENDER MESSAGE (Markdown)
// ============================================
function renderMarkdown(text) {
    if (typeof marked === 'undefined') {
        return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    }
    return marked.parse(text);
}

// ============================================
// THEME TOGGLE (Dark / Light Mode)
// ============================================
function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);

    const moonIcon = document.querySelector('.moon-icon');
    const sunIcon = document.querySelector('.sun-icon');

    if (newTheme === 'light') {
        moonIcon.style.display = 'none';
        sunIcon.style.display = 'block';
        // Switch highlight.js theme
        document.getElementById('hljs-theme').href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-light.min.css';
    } else {
        moonIcon.style.display = 'block';
        sunIcon.style.display = 'none';
        document.getElementById('hljs-theme').href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css';
    }

    showToast(newTheme === 'light' ? '☀️ Light mode' : '🌙 Dark mode', 'info');
}

function loadSavedTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    if (saved === 'light') {
        document.querySelector('.moon-icon').style.display = 'none';
        document.querySelector('.sun-icon').style.display = 'block';
        document.getElementById('hljs-theme').href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-light.min.css';
    }
}

// ============================================
// MODEL SWITCHER
// ============================================
function switchModel(modelId) {
    currentModel = modelId;
    const modelNames = {
        'gpt-oss-120b': 'GPT OSS 120B',
        'zai-glm-4.7': 'Z.ai GLM 4.7'
    };
    document.getElementById('modelLabel').textContent = modelNames[modelId] || modelId;
    showToast(`🤖 Switched to ${modelNames[modelId]}`, 'info');
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================
function showToast(message, type = 'info', duration = 2500) {
    const container = document.getElementById('toastContainer');
    const icons = {
        success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
        info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span>${message}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ============================================
// FORMAT TIME
// ============================================
function getTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ============================================
// AUTO RESIZE TEXTAREA
// ============================================
function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// ============================================
// HANDLE ENTER KEY
// ============================================
function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

// ============================================
// SEND MESSAGE
// ============================================
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (text === '') return;

    input.value = '';
    input.style.height = 'auto';

    addMessage(text, 'user');

    // Remove any existing suggested replies
    removeSuggestedReplies();

    const requestBody = {
        message: text,
        session_id: currentSessionId,
        web_search: isWebSearchEnabled,
        system_prompt: localStorage.getItem('systemPrompt') || null,
        model: currentModel
    };

    lastRequestBody = requestBody;
    await streamResponse(requestBody);
}

// ============================================
// STREAM RESPONSE
// ============================================
async function streamResponse(requestBody) {
    showTyping();

    const welcome = document.getElementById('welcomeSection');
    if (welcome) welcome.style.display = 'none';

    try {
        const response = await fetch('/chat_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            hideTyping();
            addMessage("Error: Could not process response.", 'bot');
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        let fullText = '';
        let firstChunkReceived = false;
        let currentBubble = null;

        while (!done) {
            const { value, done: doneReading } = await reader.read();
            done = doneReading;
            if (value) {
                if (!firstChunkReceived) {
                    hideTyping();
                    addMessage('', 'bot', true); // streaming=true = no actions yet
                    const messages = document.querySelectorAll('.message.bot .message-bubble');
                    currentBubble = messages[messages.length - 1];
                    firstChunkReceived = true;
                }
                const chunk = decoder.decode(value, { stream: !done });
                fullText += chunk;
                currentBubble.innerHTML = renderMarkdown(fullText);
                // Re-apply hljs
                if (typeof hljs !== 'undefined') {
                    currentBubble.querySelectorAll('pre code').forEach(block => {
                        if (!block.dataset.highlighted) {
                            block.dataset.highlighted = 'yes';
                        }
                    });
                }
                scrollToBottomAuto();
            }
        }

        if (!firstChunkReceived) {
            hideTyping();
        }

        // After streaming done, add action buttons + reactions + suggestions
        if (firstChunkReceived && fullText) {
            const lastMsg = document.querySelector('#chatMessages .message.bot:last-child');
            if (lastMsg) {
                finalizeMessage(lastMsg, fullText);
            }
            showSuggestedReplies(fullText);
        }

        loadSessions();
    } catch (error) {
        hideTyping();
        addMessage(`⚠️ Connection Error: Is the FastAPI backend running?\n\`\`\`\nRun: uvicorn main:app --reload\n\`\`\``, 'bot');
        console.error('Backend Error:', error);
    }
}

// Add action buttons after streaming completes
function finalizeMessage(msgEl, fullText) {
    const actionsRow = msgEl.querySelector('.message-actions');
    if (!actionsRow) return;

    actionsRow.innerHTML = `
        <span class="message-time">${getTime()}</span>
        <button class="copy-btn" onclick="copyText(this)" title="Copy message">
            <svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:none;">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        </button>
        <button class="speaker-btn" onclick="speakText(this)" title="Read aloud">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
        </button>
        <button class="regenerate-btn" onclick="regenerateResponse(this)" title="Regenerate response">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="1 4 1 10 7 10"></polyline>
                <path d="M3.51 15a9 9 0 1 0 .49-3.45"></path>
            </svg>
        </button>
        <div class="action-divider"></div>
        <button class="reaction-btn thumbs-up" onclick="react(this, 'up')" title="Good response">👍</button>
        <button class="reaction-btn thumbs-down" onclick="react(this, 'down')" title="Bad response">👎</button>
    `;
}

// ============================================
// SEND QUICK MESSAGE
// ============================================
function sendQuickMessage(text) {
    const input = document.getElementById('messageInput');
    input.value = text;
    sendMessage();
}

// ============================================
// ADD MESSAGE TO CHAT
// ============================================
function addMessage(text, sender, streaming = false) {
    const container = document.getElementById('chatMessages');

    const avatarContent = sender === 'user'
        ? 'U'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="#a78bfa"/></svg>';

    const formattedText = sender === 'bot' ? renderMarkdown(text) : escapeHtml(text);

    let actionsHTML = '';
    if (sender === 'bot' && !streaming) {
        actionsHTML = `
            <div class="message-actions">
                <span class="message-time">${getTime()}</span>
                <button class="copy-btn" onclick="copyText(this)" title="Copy message">
                    <svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:none;">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </button>
                <button class="speaker-btn" onclick="speakText(this)" title="Read aloud">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    </svg>
                </button>
                <button class="regenerate-btn" onclick="regenerateResponse(this)" title="Regenerate response">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="1 4 1 10 7 10"></polyline>
                        <path d="M3.51 15a9 9 0 1 0 .49-3.45"></path>
                    </svg>
                </button>
                <div class="action-divider"></div>
                <button class="reaction-btn thumbs-up" onclick="react(this, 'up')" title="Good response">👍</button>
                <button class="reaction-btn thumbs-down" onclick="react(this, 'down')" title="Bad response">👎</button>
            </div>
        `;
    } else if (sender === 'bot' && streaming) {
        // placeholder — will be filled by finalizeMessage
        actionsHTML = `<div class="message-actions"><span class="message-time">${getTime()}</span></div>`;
    } else {
        actionsHTML = `<div class="message-actions" style="justify-content:flex-end;"><span class="message-time">${getTime()}</span></div>`;
    }

    const messageHTML = `
        <div class="message ${sender}">
            <div class="message-avatar">${avatarContent}</div>
            <div class="message-content">
                <div class="message-bubble">${formattedText}</div>
                ${actionsHTML}
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', messageHTML);
    scrollToBottomAuto();
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ============================================
// REACTIONS
// ============================================
function react(btn, type) {
    const bar = btn.closest('.message-actions');
    const allBtns = bar.querySelectorAll('.reaction-btn');

    // Toggle off if already active
    if (btn.classList.contains('active')) {
        btn.classList.remove('active');
        showToast('Reaction removed', 'info', 1500);
        return;
    }

    allBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (type === 'up') {
        showToast('👍 Thanks for the positive feedback!', 'success');
    } else {
        showToast('👎 Sorry! We\'ll improve.', 'info');
    }
}

// ============================================
// REGENERATE RESPONSE
// ============================================
async function regenerateResponse(btn) {
    // Animate the icon
    btn.classList.add('spinning');
    setTimeout(() => btn.classList.remove('spinning'), 500);

    // Remove last bot message visually
    const allBotMsgs = document.querySelectorAll('#chatMessages .message.bot');
    if (allBotMsgs.length > 0) {
        allBotMsgs[allBotMsgs.length - 1].remove();
    }
    removeSuggestedReplies();

    showToast('🔄 Regenerating response...', 'info', 1500);
    
    const requestBody = lastRequestBody || {
        message: "regenerate_dummy",
        session_id: currentSessionId,
        web_search: isWebSearchEnabled,
        system_prompt: localStorage.getItem('systemPrompt') || null,
        model: currentModel
    };

    await streamResponse({ ...requestBody, regenerate: true });
}

// ============================================
// SUGGESTED REPLIES
// ============================================
const suggestionSets = {
    pricing: ['Tell me about the Pro Plan', 'Do you have a free trial?', 'Compare all plans'],
    technical: ['My app keeps crashing', 'How to reset API key?', 'Contact human support'],
    refund: ['How long does refund take?', 'I want to cancel subscription', 'Billing issue help'],
    features: ['Show me integrations', 'Does it support Urdu?', 'API documentation'],
    thanks: ['One more question', 'That\'s all, thanks!', 'Start new chat'],
    default: ['Tell me more', 'Give me an example', 'How can I get started?']
};

function detectSuggestions(botText) {
    const text = botText.toLowerCase();
    if (/(price|plan|subscription|\$[0-9])/.test(text)) return suggestionSets.pricing;
    if (/(technical|error|bug|fix|issue|crash)/.test(text)) return suggestionSets.technical;
    if (/(refund|cancel|billing|money back)/.test(text)) return suggestionSets.refund;
    if (/(feature|capability|integration|multi.language)/.test(text)) return suggestionSets.features;
    if (/(welcome|happy to help|great|glad)/.test(text)) return suggestionSets.thanks;
    return suggestionSets.default;
}

function showSuggestedReplies(botText) {
    removeSuggestedReplies();
    const suggestions = detectSuggestions(botText);
    const container = document.getElementById('chatMessages');

    const div = document.createElement('div');
    div.className = 'suggested-replies';
    div.id = 'suggestedReplies';
    suggestions.forEach(s => {
        const chip = document.createElement('button');
        chip.className = 'suggest-chip';
        chip.textContent = s;
        chip.onclick = () => { sendQuickMessage(s); };
        div.appendChild(chip);
    });
    container.appendChild(div);
    scrollToBottomAuto();
}

function removeSuggestedReplies() {
    const el = document.getElementById('suggestedReplies');
    if (el) el.remove();
}

// ============================================
// COPY MESSAGE
// ============================================
function copyText(btn) {
    const bubble = btn.closest('.message-content').querySelector('.message-bubble');
    const textToCopy = bubble.innerText;

    navigator.clipboard.writeText(textToCopy).then(() => {
        const copyIcon = btn.querySelector('.copy-icon');
        const checkIcon = btn.querySelector('.check-icon');

        copyIcon.style.display = 'none';
        checkIcon.style.display = 'inline';
        btn.style.color = 'var(--success-green)';
        btn.title = 'Copied!';

        setTimeout(() => {
            copyIcon.style.display = 'inline';
            checkIcon.style.display = 'none';
            btn.style.color = '';
            btn.title = 'Copy message';
        }, 2000);

        showToast('✅ Copied to clipboard!', 'success', 1800);
    }).catch(() => {
        showToast('❌ Failed to copy', 'error');
    });
}

// Copy code block
function copyCodeBlock(btn) {
    const code = btn.closest('pre').querySelector('code');
    navigator.clipboard.writeText(code.innerText).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 2000);
    });
}

// ============================================
// CHAT SEARCH
// ============================================
function searchChats(query) {
    const items = document.querySelectorAll('#historyList .history-item');
    const q = query.toLowerCase().trim();
    items.forEach(item => {
        const title = item.querySelector('.chat-title-text');
        if (!title) return;
        if (q === '' || title.textContent.toLowerCase().includes(q)) {
            item.classList.remove('hidden');
        } else {
            item.classList.add('hidden');
        }
    });
}

// ============================================
// SCROLL TO BOTTOM
// ============================================
function scrollToBottomAuto() {
    const container = document.getElementById('messagesContainer');
    if (isAtBottom) {
        setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
    }
}

function scrollToBottomNow() {
    const container = document.getElementById('messagesContainer');
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    isAtBottom = true;
    document.getElementById('scrollBottomBtn').classList.remove('visible');
}

// Monitor scroll position for "scroll to bottom" button
document.getElementById('messagesContainer').addEventListener('scroll', () => {
    const container = document.getElementById('messagesContainer');
    const btn = document.getElementById('scrollBottomBtn');
    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isAtBottom = distFromBottom < 80;
    if (distFromBottom > 200) {
        btn.classList.add('visible');
    } else {
        btn.classList.remove('visible');
    }
});

// ============================================
// SHOW / HIDE TYPING
// ============================================
function showTyping() {
    document.getElementById('typingIndicator').classList.add('active');
    scrollToBottomAuto();
}

function hideTyping() {
    document.getElementById('typingIndicator').classList.remove('active');
}

// ============================================
// START NEW CHAT
// ============================================
function startNewChat() {
    currentSessionId = crypto.randomUUID();
    lastRequestBody = null;
    document.getElementById('chatMessages').innerHTML = '';
    removeSuggestedReplies();

    const welcome = document.getElementById('welcomeSection');
    if (welcome) welcome.style.display = 'flex';

    document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
    document.getElementById('chatTitle').textContent = 'New Chat';
}

// ============================================
// LOAD SESSIONS (Sidebar History)
// ============================================
async function loadSessions() {
    try {
        const res = await fetch('/sessions');
        const sessions = await res.json();

        const historyList = document.getElementById('historyList');
        historyList.innerHTML = '';

        sessions.forEach(session => {
            const isActive = session.id === currentSessionId ? 'active' : '';
            const html = `
                <div class="history-item ${isActive}" onclick="loadChat('${session.id}', this)" id="chat-item-${session.id}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <div style="flex:1; overflow:hidden; margin-left:8px;" class="chat-title-container">
                        <span class="chat-title-text" style="display:block; text-overflow:ellipsis; white-space:nowrap; overflow:hidden;">${session.title}</span>
                        <input type="text" class="chat-title-input" value="${session.title.replace(/"/g, '&quot;')}" style="display:none; width:100%; background:transparent; border:1px solid var(--purple-500); color:var(--text-primary); outline:none; border-radius:4px; padding:2px 4px; font-family:var(--font-main); font-size:0.88rem;" onblur="saveRename('${session.id}')" onkeydown="handleRenameKey(event, '${session.id}')" onclick="event.stopPropagation()">
                    </div>
                    <div class="chat-options-container" onclick="event.stopPropagation()">
                        <button class="chat-options-btn" onclick="toggleOptionsMenu('${session.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="1"></circle>
                                <circle cx="12" cy="5" r="1"></circle>
                                <circle cx="12" cy="19" r="1"></circle>
                            </svg>
                        </button>
                        <div class="chat-options-menu" id="menu-${session.id}">
                            <button onclick="startRename('${session.id}')">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                                Rename
                            </button>
                            <div id="delete-container-${session.id}">
                                <button class="delete" onclick="confirmDeleteUi('${session.id}')">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="3 6 5 6 21 6"></polyline>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                    </svg>
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            historyList.insertAdjacentHTML('beforeend', html);
        });
    } catch (e) {
        console.error('Failed to load sessions', e);
    }
}

// ============================================
// LOAD CHAT
// ============================================
async function loadChat(sessionId, element) {
    currentSessionId = sessionId;

    document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
    if (element) element.classList.add('active');

    const container = document.getElementById('chatMessages');
    container.innerHTML = '';
    removeSuggestedReplies();

    const welcome = document.getElementById('welcomeSection');
    if (welcome) welcome.style.display = 'none';

    const titleEl = element?.querySelector('.chat-title-text');
    if (titleEl) document.getElementById('chatTitle').textContent = titleEl.textContent;

    try {
        const res = await fetch(`/chat/${sessionId}`);
        const messages = await res.json();
        messages.forEach(msg => {
            addMessage(msg.content, msg.role === 'user' ? 'user' : 'bot');
        });
    } catch (e) {
        console.error('Failed to load chat', e);
    }
}

// ============================================
// DELETE / RENAME HELPERS
// ============================================
function resetDeleteMenu(sessionId) {
    const delContainer = document.getElementById(`delete-container-${sessionId}`);
    if (delContainer) {
        delContainer.innerHTML = `
            <button class="delete" onclick="confirmDeleteUi('${sessionId}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                Delete
            </button>
        `;
    }
}

function confirmDeleteUi(sessionId) {
    const container = document.getElementById(`delete-container-${sessionId}`);
    container.innerHTML = `
        <button class="delete" style="color:white; background:#ef4444;" onclick="executeDelete('${sessionId}', event)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Confirm
        </button>
    `;
}

async function executeDelete(sessionId, event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById(`menu-${sessionId}`);
    if (menu) menu.classList.remove('show');
    const item = document.getElementById(`chat-item-${sessionId}`);
    if (item) item.style.display = 'none';
    try {
        await fetch(`/chat/${sessionId}`, { method: 'DELETE' });
        if (currentSessionId === sessionId) startNewChat();
        showToast('🗑️ Chat deleted', 'info');
    } catch (e) {
        if (item) item.style.display = 'flex';
        showToast('❌ Failed to delete', 'error');
    }
}

function toggleOptionsMenu(sessionId) {
    document.querySelectorAll('.chat-options-menu').forEach(menu => {
        if (menu.id !== `menu-${sessionId}`) {
            menu.classList.remove('show');
            const menuId = menu.id.replace('menu-', '');
            resetDeleteMenu(menuId);
        }
    });
    const menu = document.getElementById(`menu-${sessionId}`);
    if (menu) menu.classList.toggle('show');
    resetDeleteMenu(sessionId);
}

function startRename(sessionId) {
    const menu = document.getElementById(`menu-${sessionId}`);
    if (menu) menu.classList.remove('show');
    const item = document.getElementById(`chat-item-${sessionId}`);
    const textSpan = item.querySelector('.chat-title-text');
    const inputField = item.querySelector('.chat-title-input');
    textSpan.style.display = 'none';
    inputField.style.display = 'block';
    inputField.focus();
    inputField.select();
}

function handleRenameKey(event, sessionId) {
    if (event.key === 'Enter') saveRename(sessionId);
    else if (event.key === 'Escape') {
        const item = document.getElementById(`chat-item-${sessionId}`);
        const textSpan = item.querySelector('.chat-title-text');
        const inputField = item.querySelector('.chat-title-input');
        inputField.value = textSpan.innerText;
        inputField.style.display = 'none';
        textSpan.style.display = 'block';
    }
}

async function saveRename(sessionId) {
    const item = document.getElementById(`chat-item-${sessionId}`);
    if (!item) return;
    const textSpan = item.querySelector('.chat-title-text');
    const inputField = item.querySelector('.chat-title-input');
    const newTitle = inputField.value.trim();
    if (!newTitle || newTitle === textSpan.innerText) {
        inputField.value = textSpan.innerText;
        inputField.style.display = 'none';
        textSpan.style.display = 'block';
        return;
    }
    textSpan.innerText = newTitle;
    inputField.style.display = 'none';
    textSpan.style.display = 'block';
    try {
        await fetch(`http://127.0.0.1:8000/chat/${sessionId}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle })
        });
        showToast('✏️ Chat renamed', 'success', 1500);
    } catch (e) {
        console.error('Failed to rename', e);
    }
}

// ============================================
// SIDEBAR TOGGLE
// ============================================
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.toggle('collapsed');
    
    // Update toggle button icon
    const isClosed = sidebar.classList.contains('collapsed');
    const btn = document.querySelector('.menu-toggle');
    if (isClosed) {
        btn.title = 'Open Sidebar';
        btn.style.color = 'var(--purple-400)';
    } else {
        btn.title = 'Close Sidebar';
        btn.style.color = '';
    }
}

// Close sidebar on outside click (mobile)
document.addEventListener('click', (e) => {
    const sidebar = document.querySelector('.sidebar');
    const menuToggle = document.querySelector('.menu-toggle');
    if (window.innerWidth <= 768 &&
        !sidebar.contains(e.target) &&
        menuToggle && !menuToggle.contains(e.target) &&
        sidebar.classList.contains('mobile-open')) {
        sidebar.classList.remove('mobile-open');
    }
});

// Close menus on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.chat-options-container')) {
        document.querySelectorAll('.chat-options-menu').forEach(menu => {
            if (menu.classList.contains('show')) {
                menu.classList.remove('show');
                const menuId = menu.id.replace('menu-', '');
                resetDeleteMenu(menuId);
            }
        });
    }
    if (!e.target.closest('.attach-wrapper')) {
        const attachMenu = document.getElementById('attachMenu');
        if (attachMenu && attachMenu.classList.contains('show')) {
            attachMenu.classList.remove('show');
        }
    }
});

// ============================================
// WEB SEARCH TOGGLE
// ============================================
function toggleWebSearch() {
    isWebSearchEnabled = !isWebSearchEnabled;
    const btn = document.getElementById('webSearchBtn');
    if (isWebSearchEnabled) {
        btn.classList.add('active');
        btn.title = 'Web Search: ON';
        showToast('🌐 Web search enabled', 'info', 1500);
    } else {
        btn.classList.remove('active');
        btn.title = 'Web Search: OFF';
        showToast('🌐 Web search disabled', 'info', 1500);
    }
}

// ============================================
// ATTACH MENU
// ============================================
function toggleAttachMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('attachMenu');
    if (menu) menu.classList.toggle('show');
}

function triggerFileInput(acceptType) {
    const fileInput = document.getElementById('fileInput');
    fileInput.setAttribute('accept', acceptType);
    fileInput.click();
    const menu = document.getElementById('attachMenu');
    if (menu) menu.classList.remove('show');
}

// ============================================
// FILE UPLOAD
// ============================================
document.getElementById('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const welcome = document.getElementById('welcomeSection');
    if (welcome) welcome.style.display = 'none';

    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function(event) {
            const base64Url = event.target.result;
            const imgHtml = `<img src="${base64Url}" style="max-width:250px; border-radius:8px; margin-top:10px; display:block; border:2px solid var(--border-color);">`;
            addMessage(`*Attached Image: ${file.name}*<br>${imgHtml}`, 'user');
        };
        reader.readAsDataURL(file);
    } else {
        addMessage(`*Uploading: ${file.name}...*`, 'user');
    }

    showTyping();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('session_id', currentSessionId);

    try {
        const res = await fetch('/upload', { method: 'POST', body: formData });
        hideTyping();
        if (res.ok) {
            loadSessions();
            await streamResponse({
                message: "I have just attached a file/image. Please read the document context and directly explain or summarize what is in it in a friendly way.",
                session_id: currentSessionId,
                web_search: isWebSearchEnabled,
                system_prompt: localStorage.getItem('systemPrompt') || null,
                model: currentModel
            });
        } else {
            addMessage('❌ Failed to upload file.', 'bot');
        }
    } catch (err) {
        hideTyping();
        addMessage(`❌ Error: ${err.message}`, 'bot');
    }

    e.target.value = '';
});

// ============================================
// SETTINGS MODAL
// ============================================
function openSettings() {
    const modal = document.getElementById('settingsModal');
    document.getElementById('systemPrompt').value = localStorage.getItem('systemPrompt') || '';
    modal.style.display = 'flex';
}

function closeSettings() {
    document.getElementById('settingsModal').style.display = 'none';
}

function saveSettings() {
    const promptInput = document.getElementById('systemPrompt').value.trim();
    if (promptInput) {
        localStorage.setItem('systemPrompt', promptInput);
    } else {
        localStorage.removeItem('systemPrompt');
    }
    closeSettings();
    showToast('✅ Settings saved', 'success');
}

document.getElementById('settingsModal').addEventListener('click', function(e) {
    if (e.target === this) closeSettings();
});

// ============================================
// EXPORT CHAT (TXT)
// ============================================
function exportChat() {
    const messages = document.querySelectorAll('.message');
    if (messages.length === 0) { showToast('No messages to export', 'error'); return; }

    let chatText = '=== NexusAI Chat Export ===\n\n';
    messages.forEach(msg => {
        const isUser = msg.classList.contains('user');
        const role = isUser ? 'You' : 'NexusAI';
        const timeEl = msg.querySelector('.message-time');
        const time = timeEl ? timeEl.innerText : '';
        const content = msg.querySelector('.message-bubble').innerText;
        chatText += `[${time}] ${role}:\n${content}\n\n`;
    });

    const blob = new Blob([chatText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NexusAI_Chat_${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📄 Chat exported as TXT', 'success');
}

// ============================================
// EXPORT CHAT (PDF)
// ============================================
function exportPDF() {
    const messages = document.querySelectorAll('.message');
    if (messages.length === 0) { showToast('No messages to export', 'error'); return; }

    const printWindow = window.open('', '_blank');
    const theme = document.documentElement.getAttribute('data-theme');

    let html = `
        <!DOCTYPE html><html><head>
        <title>NexusAI Chat Export</title>
        <style>
            body { font-family: 'Inter', Arial, sans-serif; background: ${theme === 'dark' ? '#0a0a0f' : '#fff'}; color: ${theme === 'dark' ? '#f1f0f5' : '#1a1a2e'}; padding: 30px; max-width: 800px; margin: 0 auto; }
            h1 { font-size: 1.4rem; margin-bottom: 4px; color: #8b5cf6; }
            .meta { font-size: 0.8rem; color: #888; margin-bottom: 24px; }
            .msg { margin-bottom: 16px; display: flex; gap: 10px; }
            .msg.user { flex-direction: row-reverse; }
            .bubble { padding: 12px 16px; border-radius: 14px; max-width: 75%; font-size: 0.9rem; line-height: 1.6; }
            .msg.bot .bubble { background: ${theme === 'dark' ? '#1a1a2e' : '#f0eeff'}; border: 1px solid #a78bfa33; }
            .msg.user .bubble { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: white; }
            .label { font-size: 0.7rem; color: #888; margin-bottom: 2px; text-align: right; }
            .msg.bot .label { text-align: left; }
            pre { background: #1e1e2e; padding: 10px; border-radius: 8px; overflow-x: auto; font-size: 0.8rem; }
        </style></head><body>
        <h1>🤖 NexusAI Chat</h1>
        <div class="meta">Exported on ${new Date().toLocaleString()}</div>
    `;

    messages.forEach(msg => {
        const isUser = msg.classList.contains('user');
        const role = isUser ? 'You' : 'NexusAI';
        const content = msg.querySelector('.message-bubble').innerHTML;
        const timeEl = msg.querySelector('.message-time');
        const time = timeEl ? timeEl.innerText : '';
        html += `<div class="msg ${isUser ? 'user' : 'bot'}"><div><div class="label">${role} · ${time}</div><div class="bubble">${content}</div></div></div>`;
    });

    html += `</body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); }, 500);
    showToast('📄 PDF export ready!', 'success');
}

// ============================================
// VOICE — TEXT TO SPEECH
// ============================================
function speakText(btn) {
    if (!('speechSynthesis' in window)) {
        showToast('❌ TTS not supported in this browser', 'error');
        return;
    }
    const bubble = btn.closest('.message-content').querySelector('.message-bubble');
    const textToSpeak = bubble.innerText;
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        document.querySelectorAll('.speaker-btn').forEach(b => b.style.color = '');
        return;
    }
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = 'en-US';
    btn.style.color = 'var(--purple-400)';
    utterance.onend = () => { btn.style.color = ''; };
    window.speechSynthesis.speak(utterance);
    showToast('🔊 Reading aloud...', 'info', 1500);
}

// ============================================
// VOICE — SPEECH TO TEXT
// ============================================
let recognition = null;
let isRecording = false;

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = function() {
        isRecording = true;
        document.getElementById('micBtn').classList.add('recording');
        showToast('🎙️ Listening...', 'info', 3000);
    };

    recognition.onresult = function(event) {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        }
        if (finalTranscript) {
            const input = document.getElementById('messageInput');
            input.value += (input.value && !input.value.endsWith(' ') ? ' ' : '') + finalTranscript;
            autoResize(input);
        }
    };

    recognition.onerror = function(event) { console.error('Speech error', event.error); stopRecording(); };
    recognition.onend = function() { stopRecording(); };
}

function toggleMic() {
    if (!recognition) {
        showToast('❌ Microphone not supported in this browser', 'error');
        return;
    }
    if (isRecording) { recognition.stop(); stopRecording(); }
    else { try { recognition.start(); } catch(e) { stopRecording(); } }
}

function stopRecording() {
    isRecording = false;
    document.getElementById('micBtn').classList.remove('recording');
}

// ============================================
// PAGE LOAD INIT
// ============================================
window.addEventListener('load', () => {
    setupMarked();
    loadSavedTheme();
    document.getElementById('messageInput').focus();
    loadSessions();

    // Load saved model
    const savedModel = localStorage.getItem('selectedModel');
    const validModels = ['gpt-oss-120b', 'zai-glm-4.7'];
    
    if (savedModel && validModels.includes(savedModel)) {
        currentModel = savedModel;
        const selector = document.getElementById('modelSelector');
        if (selector) selector.value = savedModel;
        switchModel(savedModel);
    } else {
        // If old/invalid model is saved, force reset to default
        currentModel = 'gpt-oss-120b';
        localStorage.setItem('selectedModel', currentModel);
        const selector = document.getElementById('modelSelector');
        if (selector) selector.value = currentModel;
        switchModel(currentModel);
    }
});

// Save selected model
document.getElementById('modelSelector').addEventListener('change', (e) => {
    localStorage.setItem('selectedModel', e.target.value);
});


