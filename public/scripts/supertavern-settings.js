import { debounce, download } from './utils.js';

const DEFAULT_SETTINGS = {
    multiUser: {
        enabled: false,
        crossTalk: true,
        privateSideChats: true,
        conflictResolution: true,
        role: 'participant',
        clientId: '',
    },
    sharedMemory: {
        enabled: false,
        projectScoped: true,
        privacyControls: true,
        maxEntries: 100,
        entries: {},
    },
    gamification: {
        enabled: false,
        xp: 0,
        level: 1,
        achievements: [],
        counters: {
            message_sent: 0,
            message_received: 0,
            remote_message: 0,
        },
        lastActivity: 0,
    },
    accessibility: {
        highContrast: false,
        dyslexiaFriendly: false,
        reducedMotion: false,
        focusManagement: true,
    },
    team: {
        analyticsEnabled: false,
        memberStats: {},
    },
    customization: {
        dynamicThemes: false,
    },
};

const CROSS_TALK_REGEX = /^\/([^\s]+)\s+([\s\S]+)$/;
const BROADCAST_CHANNEL = 'supertavern-multiuser';
const MAX_SHARED_SUMMARY_LENGTH = 280;

let state = deepClone(DEFAULT_SETTINGS);
let dependencies = {
    eventSource: null,
    event_types: null,
    getChat: null,
    insertRemoteMessage: null,
    reloadCurrentChat: null,
    getCurrentChatId: null,
    getActiveGroup: null,
    getActiveCharacter: null,
    getLocalUserIdentity: null,
    saveSettingsDebounced: null,
};

let broadcastChannel = null;
let listenersRegistered = false;
let lastStatus = 'Offline';
const processedMessages = new Set();
const remoteMessageVersions = new Map();

const schedulePersist = debounce(() => dependencies.saveSettingsDebounced?.(), 800);

export function configureSuperTavern(newDependencies) {
    dependencies = { ...dependencies, ...newDependencies };
    registerCoreListeners();
}

export function initializeSuperTavernUI() {
    const panel = getPanel();
    if (!panel || panel.dataset.supertavernInitialized === 'true') {
        return;
    }

    panel.dataset.supertavernInitialized = 'true';

    panel.querySelectorAll('[data-supertavern-setting]').forEach((element) => {
        const path = element.getAttribute('data-supertavern-setting');
        if (!path) {
            return;
        }

        if (element instanceof HTMLInputElement && element.type === 'checkbox') {
            element.addEventListener('change', () => {
                const changed = setStateValue(path, element.checked);
                if (!changed) {
                    return;
                }

                applyState();
                render();
                schedulePersist();
            });
        } else if (element instanceof HTMLSelectElement) {
            element.addEventListener('change', () => {
                const changed = setStateValue(path, element.value);
                if (!changed) {
                    return;
                }

                applyState();
                render();
                schedulePersist();
            });
        }
    });

    panel.querySelector('#supertavern-shared-memory-export')?.addEventListener('click', exportSharedMemorySnapshot);
    panel.querySelector('#supertavern-shared-memory-clear')?.addEventListener('click', clearSharedMemory);

    render();
}

export async function loadSuperTavernState(savedState = {}) {
    state = mergeDeep(deepClone(DEFAULT_SETTINGS), savedState ?? {});
    ensureClientId();
    applyState();
    render();
}

export function getSuperTavernState() {
    return state;
}

function registerCoreListeners() {
    if (listenersRegistered) {
        return;
    }

    if (!dependencies.eventSource || !dependencies.event_types) {
        return;
    }

    dependencies.eventSource.on(dependencies.event_types.MESSAGE_SENT, handleMessageSent);
    dependencies.eventSource.on(dependencies.event_types.MESSAGE_RECEIVED, handleMessageReceived);
    listenersRegistered = true;
}

function handleMessageSent(messageId) {
    const message = getMessageById(messageId);
    if (!message) {
        return;
    }

    if (state.multiUser.enabled) {
        ensureClientId();
        const channel = ensureMultiUserChannel();
        if (channel) {
            broadcastLocalMessage(message);
        }
    }

    let changed = false;

    if (state.sharedMemory.enabled) {
        changed = updateSharedMemory(message, { direction: 'sent' }) || changed;
    }

    if (state.gamification.enabled && !message.extra?.supertavernRemote) {
        addExperience('message_sent');
        changed = true;
    }

    if (state.team.analyticsEnabled) {
        changed = updateTeamAnalytics(message) || changed;
    }

    if (state.customization.dynamicThemes) {
        updateDynamicTheme();
    }

    if (changed) {
        render();
        schedulePersist();
    }
}

function handleMessageReceived(messageId, type) {
    const message = getMessageById(messageId);
    if (!message) {
        return;
    }

    let changed = false;

    if (state.sharedMemory.enabled) {
        changed = updateSharedMemory(message, { direction: 'received', type }) || changed;
    }

    if (state.gamification.enabled) {
        if (message.extra?.supertavernRemote) {
            addExperience('remote_message');
        } else if (!message.is_user) {
            addExperience('message_received');
        }
        changed = true;
    }

    if (state.team.analyticsEnabled) {
        changed = updateTeamAnalytics(message) || changed;
    }

    if (state.customization.dynamicThemes) {
        updateDynamicTheme();
    }

    if (changed) {
        render();
        schedulePersist();
    }
}

function getMessageById(messageId) {
    const chat = dependencies.getChat?.();
    if (!Array.isArray(chat)) {
        return null;
    }

    return chat[messageId] ?? null;
}

function ensureMultiUserChannel() {
    if (!state.multiUser.enabled) {
        return null;
    }

    if (broadcastChannel) {
        return broadcastChannel;
    }

    if (typeof window.BroadcastChannel !== 'function') {
        setMultiUserStatus('Unsupported');
        return null;
    }

    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL);
    broadcastChannel.onmessage = (event) => {
        onBroadcastMessage(event.data);
    };
    setMultiUserStatus('Connected');
    return broadcastChannel;
}

function teardownMultiUserChannel() {
    if (!broadcastChannel) {
        return;
    }

    broadcastChannel.close();
    broadcastChannel = null;
    setMultiUserStatus('Offline');
}

function broadcastLocalMessage(message) {
    if (!message.is_user || message.extra?.supertavernRemote) {
        return;
    }

    const channel = ensureMultiUserChannel();
    if (!channel) {
        return;
    }

    const identity = dependencies.getLocalUserIdentity?.() || {};
    const prepared = prepareBroadcastPayload(message, identity);
    if (!prepared) {
        return;
    }

    processedMessages.add(prepared.id);
    channel.postMessage(prepared);
}

function prepareBroadcastPayload(message, identity) {
    const clone = {
        ...message,
        extra: { ...message.extra },
    };

    const broadcastId = clone.extra?.supertavernMessageId || createClientId();
    clone.extra.supertavernMessageId = broadcastId;

    const match = state.multiUser.crossTalk ? message.mes?.match(CROSS_TALK_REGEX) : null;
    let target = null;
    let sanitizedText = message.mes;
    if (match) {
        target = match[1];
        sanitizedText = match[2];
        clone.extra.supertavernPrivateRecipients = target;
    }

    const payload = {
        id: broadcastId,
        clientId: state.multiUser.clientId,
        timestamp: Date.now(),
        room: getRoomKey(),
        message: {
            name: clone.name,
            mes: sanitizedText,
            send_date: clone.send_date,
            extra: {
                supertavernRemote: true,
                supertavernOriginRole: state.multiUser.role,
                supertavernOriginHandle: identity.handle || identity.name || '',
            },
        },
        rawText: message.mes,
        role: state.multiUser.role,
        handle: identity.handle || identity.name || '',
        avatar: identity.avatar || '',
        target,
        version: 1,
    };

    return payload;
}

async function onBroadcastMessage(payload) {
    if (!payload || typeof payload !== 'object') {
        return;
    }

    if (!state.multiUser.enabled) {
        return;
    }

    if (payload.clientId === state.multiUser.clientId) {
        return;
    }

    if (payload.room && payload.room !== getRoomKey()) {
        return;
    }

    if (processedMessages.has(payload.id)) {
        if (state.multiUser.conflictResolution) {
            updateExistingRemoteMessage(payload);
        }
        return;
    }

    const message = transformPayloadToMessage(payload);
    if (!message) {
        return;
    }

    processedMessages.add(payload.id);
    remoteMessageVersions.set(payload.id, payload.timestamp ?? Date.now());

    await dependencies.insertRemoteMessage?.(message, { broadcastId: payload.id, eventTag: 'supertavern_remote' });
    render();
    schedulePersist();
}

function transformPayloadToMessage(payload) {
    const identity = dependencies.getLocalUserIdentity?.() || {};
    const localName = (identity.name || '').toLowerCase();
    const isModerator = state.multiUser.role === 'moderator';
    const target = (payload.target || '').toLowerCase();
    const isPrivate = Boolean(target);
    const isRecipient = target && localName === target.toLowerCase();

    if (isPrivate && state.multiUser.privateSideChats && !isRecipient && !isModerator) {
        return null;
    }

    const messageText = isPrivate && payload.message?.mes ? payload.message.mes : payload.rawText ?? payload.message?.mes ?? '';

    const message = {
        name: payload.message?.name || payload.handle || 'Participant',
        is_user: true,
        is_system: false,
        send_date: payload.message?.send_date || new Date().toISOString(),
        mes: messageText,
        extra: {
            ...(payload.message?.extra || {}),
            supertavernRemote: true,
            supertavernMessageId: payload.id,
            supertavernOriginRole: payload.role || 'participant',
            supertavernOriginHandle: payload.handle || payload.message?.name || '',
        },
    };

    if (payload.avatar) {
        message.force_avatar = payload.avatar;
    }

    if (isPrivate) {
        message.extra.supertavernPrivateRecipients = payload.target;
        if (!isRecipient && isModerator) {
            message.mes = `(Whisper to ${payload.target}) ${payload.message?.mes ?? ''}`;
        }
    }

    return message;
}

function updateExistingRemoteMessage(payload) {
    const chat = dependencies.getChat?.();
    if (!Array.isArray(chat)) {
        return;
    }

    const index = chat.findIndex((mes) => mes?.extra?.supertavernMessageId === payload.id);
    if (index === -1) {
        return;
    }

    const currentTimestamp = remoteMessageVersions.get(payload.id) ?? 0;
    if ((payload.timestamp ?? 0) < currentTimestamp) {
        return;
    }

    remoteMessageVersions.set(payload.id, payload.timestamp ?? Date.now());
    chat[index].mes = payload.rawText ?? payload.message?.mes ?? chat[index].mes;
    chat[index].extra = {
        ...chat[index].extra,
        supertavernRemote: true,
        supertavernMessageId: payload.id,
        supertavernRevision: (chat[index].extra?.supertavernRevision ?? 0) + 1,
    };
    dependencies.reloadCurrentChat?.();
}

function updateSharedMemory(message, { direction, type }) {
    if (!state.sharedMemory.enabled) {
        return false;
    }

    if (state.sharedMemory.privacyControls && message.extra?.supertavernPrivateRecipients) {
        return false;
    }

    const projectKey = getMemoryKey();
    const entries = getMemoryEntries(projectKey);
    const highlight = extractHighlight(message);

    if (!highlight) {
        return false;
    }

    const entry = {
        id: message.extra?.supertavernMessageId || createClientId(),
        author: message.name,
        role: message.extra?.supertavernOriginRole || (message.is_user ? 'participant' : 'assistant'),
        text: highlight,
        timestamp: Date.now(),
        direction,
        type,
    };

    entries.push(entry);

    while (entries.length > (state.sharedMemory.maxEntries || 100)) {
        entries.shift();
    }

    if (state.gamification.enabled) {
        addExperience('shared_memory');
    }

    return true;
}

function extractHighlight(message) {
    const raw = String(message.mes || '').trim();
    if (!raw) {
        return '';
    }

    let text = raw.replace(/\s+/g, ' ');
    if (text.length > MAX_SHARED_SUMMARY_LENGTH) {
        text = `${text.slice(0, MAX_SHARED_SUMMARY_LENGTH - 1)}…`;
    }

    return text;
}

function getMemoryEntries(projectKey) {
    if (!state.sharedMemory.entries[projectKey]) {
        state.sharedMemory.entries[projectKey] = [];
    }

    return state.sharedMemory.entries[projectKey];
}

function updateTeamAnalytics(message) {
    const stats = state.team.memberStats;
    const key = (message.extra?.supertavernOriginHandle || message.name || 'participant').toLowerCase();
    const displayName = message.extra?.supertavernOriginHandle || message.name || 'Participant';
    const role = message.extra?.supertavernOriginRole || (message.is_user ? 'participant' : 'assistant');

    if (!stats[key]) {
        stats[key] = {
            name: displayName,
            role,
            messages: 0,
        };
    }

    stats[key].messages += 1;
    stats[key].role = role;
    return true;
}

function addExperience(kind) {
    const xpMap = {
        message_sent: 5,
        message_received: 2,
        remote_message: 6,
        shared_memory: 3,
        feature_toggle: 8,
    };

    const xpGain = xpMap[kind] ?? 1;
    state.gamification.xp += xpGain;
    state.gamification.counters[kind] = (state.gamification.counters[kind] ?? 0) + 1;
    state.gamification.lastActivity = Date.now();

    const newLevel = Math.max(1, Math.floor(state.gamification.xp / 100) + 1);
    if (newLevel !== state.gamification.level) {
        state.gamification.level = newLevel;
        grantAchievement('level-' + newLevel, `Reached level ${newLevel}`);
    }

    if (kind === 'remote_message') {
        grantAchievement('collaboration', 'Welcomed a collaborator');
    }

    if (state.gamification.counters.message_sent === 1) {
        grantAchievement('first-message', 'Sent your first message');
    }

    if (state.gamification.counters.message_sent === 100) {
        grantAchievement('hundred-messages', 'Sent 100 messages');
    }

    updateDynamicTheme();
}

function grantAchievement(id, label) {
    if (state.gamification.achievements.includes(id)) {
        return;
    }

    state.gamification.achievements.push(id);
    window.toastr?.success(label, 'Achievement unlocked');
}

function render() {
    syncUIFromState();
    updateConditionalBlocks();
    renderMultiUserStatus();
    renderSharedMemory();
    renderTeamAnalytics();
    renderGamification();
    applyAccessibilityClasses();
    updateDynamicTheme();
}

function syncUIFromState() {
    const panel = getPanel();
    if (!panel) {
        return;
    }

    panel.querySelectorAll('[data-supertavern-setting]').forEach((element) => {
        const path = element.getAttribute('data-supertavern-setting');
        if (!path) {
            return;
        }

        const value = getStateValue(path);

        if (element instanceof HTMLInputElement && element.type === 'checkbox') {
            if (element.checked !== Boolean(value)) {
                element.checked = Boolean(value);
            }
        } else if (element instanceof HTMLSelectElement) {
            if (element.value !== String(value)) {
                element.value = String(value);
            }
        }
    });
}

function updateConditionalBlocks() {
    const panel = getPanel();
    if (!panel) {
        return;
    }

    panel.querySelectorAll('[data-supertavern-requires]').forEach((element) => {
        const requirement = element.getAttribute('data-supertavern-requires');
        const isActive = Boolean(getStateValue(requirement));
        element.toggleAttribute('hidden', !isActive);
    });
}

function renderMultiUserStatus() {
    const statusElement = document.getElementById('supertavern-multiuser-status');
    if (!statusElement) {
        return;
    }

    statusElement.textContent = lastStatus;
}

function renderSharedMemory() {
    const list = document.getElementById('supertavern-shared-memory-list');
    if (!list) {
        return;
    }

    list.textContent = '';

    const projectKey = getMemoryKey();
    const entries = getMemoryEntries(projectKey);

    if (!entries.length) {
        const empty = document.createElement('li');
        empty.textContent = 'Shared memory will collect highlights from the active project.';
        list.append(empty);
        return;
    }

    for (const entry of entries) {
        const item = document.createElement('li');
        const time = document.createElement('time');
        time.dateTime = new Date(entry.timestamp).toISOString();
        time.textContent = new Date(entry.timestamp).toLocaleString();

        const text = document.createElement('span');
        text.textContent = `${entry.author}: ${entry.text}`;

        item.append(time, text);
        list.append(item);
    }
}

function renderTeamAnalytics() {
    const list = document.getElementById('supertavern-team-analytics');
    if (!list) {
        return;
    }

    list.textContent = '';

    if (!state.team.analyticsEnabled) {
        return;
    }

    const values = Object.values(state.team.memberStats || {});
    if (!values.length) {
        const empty = document.createElement('li');
        empty.textContent = 'No activity recorded yet.';
        list.append(empty);
        return;
    }

    values.sort((a, b) => b.messages - a.messages);

    for (const member of values) {
        const item = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = `${member.name} (${member.role})`;
        const count = document.createElement('span');
        count.textContent = `${member.messages.toLocaleString()} messages`;
        item.append(name, count);
        list.append(item);
    }
}

function renderGamification() {
    const levelElement = document.getElementById('supertavern-xp-level');
    const progressElement = document.getElementById('supertavern-xp-progress');
    const xpValueElement = document.getElementById('supertavern-xp-value');
    const achievementsElement = document.getElementById('supertavern-achievements');

    if (!levelElement || !progressElement || !xpValueElement || !achievementsElement) {
        return;
    }

    if (!state.gamification.enabled) {
        achievementsElement.textContent = '';
        return;
    }

    const xp = state.gamification.xp;
    const currentLevel = Math.max(1, Math.floor(xp / 100) + 1);
    const xpIntoLevel = xp % 100;

    levelElement.textContent = `Level ${currentLevel}`;
    progressElement.value = xpIntoLevel;
    progressElement.max = 100;
    xpValueElement.textContent = `${xp.toLocaleString()} XP`;

    achievementsElement.textContent = '';
    if (!state.gamification.achievements.length) {
        const empty = document.createElement('li');
        empty.textContent = 'Complete activities to unlock achievements.';
        achievementsElement.append(empty);
        return;
    }

    for (const achievement of state.gamification.achievements) {
        const item = document.createElement('li');
        item.textContent = `✔ ${formatAchievementLabel(achievement)}`;
        achievementsElement.append(item);
    }
}

function formatAchievementLabel(id) {
    if (id.startsWith('level-')) {
        return `Reached ${id.replace('level-', 'level ')}`;
    }

    const labels = {
        'first-message': 'Sent the first message',
        'hundred-messages': 'Sent 100 messages',
        collaboration: 'Welcomed a collaborator',
    };

    return labels[id] || id;
}

function applyAccessibilityClasses() {
    const root = document.documentElement;
    const body = document.body;
    if (!root || !body) {
        return;
    }

    root.classList.toggle('supertavern-high-contrast', Boolean(state.accessibility.highContrast));
    root.classList.toggle('supertavern-dyslexia', Boolean(state.accessibility.dyslexiaFriendly));
    root.classList.toggle('supertavern-reduced-motion', Boolean(state.accessibility.reducedMotion));
    body.classList.toggle('supertavern-focus-tools', Boolean(state.accessibility.focusManagement));
}

function updateDynamicTheme() {
    const body = document.body;
    if (!body) {
        return;
    }

    if (!state.customization.dynamicThemes) {
        body.classList.remove('supertavern-dynamic-theme');
        document.documentElement.style.removeProperty('--supertavern-theme-alpha');
        return;
    }

    body.classList.add('supertavern-dynamic-theme');
    const xp = state.gamification.enabled ? state.gamification.xp : 0;
    const intensity = Math.min(0.35, 0.1 + (xp % 100) / 500);
    document.documentElement.style.setProperty('--supertavern-theme-alpha', intensity.toFixed(3));
}

function applyState() {
    ensureClientId();

    if (!state.multiUser.enabled) {
        teardownMultiUserChannel();
    }

    applyAccessibilityClasses();
    updateDynamicTheme();
}

function ensureClientId() {
    if (!state.multiUser.clientId) {
        state.multiUser.clientId = createClientId();
    }
}

function getStateValue(path) {
    return path.split('.').reduce((accumulator, key) => {
        if (accumulator && typeof accumulator === 'object') {
            return accumulator[key];
        }
        return undefined;
    }, state);
}

function setStateValue(path, value) {
    const keys = path.split('.');
    let target = state;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (typeof target[key] !== 'object' || target[key] === null) {
            target[key] = {};
        }
        target = target[key];
    }

    const lastKey = keys[keys.length - 1];
    if (target[lastKey] === value) {
        return false;
    }

    target[lastKey] = value;

    if (path.startsWith('multiUser') && path !== 'multiUser.clientId') {
        if (!state.multiUser.enabled) {
            teardownMultiUserChannel();
        } else {
            ensureMultiUserChannel();
        }
    }

    if (path.startsWith('accessibility')) {
        applyAccessibilityClasses();
    }

    if (path.startsWith('customization')) {
        updateDynamicTheme();
    }

    if (path === 'gamification.enabled') {
        schedulePersist();
    }

    if (path === 'team.analyticsEnabled' && !value) {
        state.team.memberStats = {};
    }

    if (path === 'sharedMemory.enabled' && !value) {
        // Keep stored data but stop updating until re-enabled
        renderSharedMemory();
    }

    if (path.endsWith('enabled') && state.gamification.enabled) {
        addExperience('feature_toggle');
    }

    return true;
}

function exportSharedMemorySnapshot() {
    const projectKey = getMemoryKey();
    const entries = getMemoryEntries(projectKey);
    const payload = {
        project: projectKey,
        generatedAt: new Date().toISOString(),
        entries,
    };

    const blob = JSON.stringify(payload, null, 2);
    download(blob, `supertavern-memory-${projectKey}.json`, 'application/json');
}

function clearSharedMemory() {
    if (!window.confirm('Clear the shared memory for this project?')) {
        return;
    }

    const key = getMemoryKey();
    state.sharedMemory.entries[key] = [];
    renderSharedMemory();
    schedulePersist();
}

function getMemoryKey() {
    if (!state.sharedMemory.projectScoped) {
        return 'global';
    }

    return getRoomKey();
}

function getRoomKey() {
    const group = dependencies.getActiveGroup?.();
    if (group) {
        return `group:${group}`;
    }

    const chatId = dependencies.getCurrentChatId?.();
    if (chatId !== undefined && chatId !== null) {
        return `chat:${chatId}`;
    }

    const character = dependencies.getActiveCharacter?.();
    if (character) {
        return `character:${character}`;
    }

    return 'global';
}

function setMultiUserStatus(status) {
    lastStatus = status;
    renderMultiUserStatus();
}

function deepClone(obj) {
    if (typeof structuredClone === 'function') {
        return structuredClone(obj);
    }

    return JSON.parse(JSON.stringify(obj));
}

function mergeDeep(target, source) {
    const output = Array.isArray(target) ? [...target] : { ...target };
    if (source && typeof source === 'object') {
        Object.keys(source).forEach((key) => {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                output[key] = mergeDeep(output[key] || {}, source[key]);
            } else {
                output[key] = source[key];
            }
        });
    }
    return output;
}

function createClientId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `client-${Math.random().toString(36).slice(2, 12)}`;
}

function getPanel() {
    return document.getElementById('supertavern-settings-panel');
}
