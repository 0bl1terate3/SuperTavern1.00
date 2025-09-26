const SESSION_TIMER_INTERVAL_MS = 1000;
const FOCUS_MODE_CLASS = 'supertavern-focus-mode';
const NOTES_STORAGE_KEY = 'supertavern.aiResponseNotes';
const DRAFT_STORAGE_KEY = 'supertavern.messageDraft';

function initTopBarFeatures() {
    const topBar = document.getElementById('top-bar');
    if (!topBar) {
        return;
    }

    const container = document.createElement('div');
    container.className = 'supertavern-top-bar';

    const brand = document.createElement('div');
    brand.className = 'supertavern-brand';
    brand.textContent = 'SuperTavern Command Deck';

    const timer = document.createElement('span');
    timer.className = 'supertavern-session-timer';
    timer.setAttribute('aria-live', 'polite');

    const focusToggle = document.createElement('button');
    focusToggle.type = 'button';
    focusToggle.className = 'supertavern-focus-toggle menu_button';
    focusToggle.innerHTML = '<i class="fa-solid fa-eye-slash"></i><span>Focus Mode</span>';

    const focusState = document.createElement('span');
    focusState.className = 'supertavern-focus-state';
    focusState.textContent = 'Focus mode off';

    focusToggle.addEventListener('click', () => {
        const isEnabled = document.body.classList.toggle(FOCUS_MODE_CLASS);
        focusState.textContent = isEnabled ? 'Focus mode on' : 'Focus mode off';
        focusToggle.classList.toggle('active', isEnabled);
    });

    container.append(brand, timer, focusToggle, focusState);
    topBar.appendChild(container);

    const updateTopBarSpacing = () => {
        const isHidden = topBar.style.display === 'none' || topBar.classList.contains('displayNone');
        document.body.classList.toggle('supertavern-top-bar-visible', !isHidden);
    };

    updateTopBarSpacing();

    const visibilityObserver = new MutationObserver(updateTopBarSpacing);
    visibilityObserver.observe(topBar, { attributes: true, attributeFilter: ['style', 'class'] });

    const start = Date.now();
    const updateTimer = () => {
        const elapsed = Math.floor((Date.now() - start) / 1000);
        const hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
        const minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        timer.textContent = `Session active: ${hours}:${minutes}:${seconds}`;
    };

    updateTimer();
    setInterval(updateTimer, SESSION_TIMER_INTERVAL_MS);
}

function initLeftPanelNotes() {
    const leftPanel = document.getElementById('left-nav-panel');
    if (!leftPanel) {
        return;
    }

    const scrollable = leftPanel.querySelector('.scrollableInner');
    if (!scrollable) {
        return;
    }

    const notesBlock = document.createElement('section');
    notesBlock.className = 'supertavern-notes-block standoutHeader';

    const header = document.createElement('div');
    header.className = 'supertavern-notes-header';
    header.innerHTML = '<i class="fa-solid fa-pen-to-square"></i><span>Session Notes</span>';

    const description = document.createElement('p');
    description.className = 'supertavern-notes-description';
    description.textContent = 'Capture quick reminders for this session. Notes are stored locally.';

    const textarea = document.createElement('textarea');
    textarea.className = 'supertavern-notes-textarea text_pole';
    textarea.rows = 4;
    textarea.placeholder = 'Write tactical reminders for your SuperTavern adventure...';
    textarea.value = localStorage.getItem(NOTES_STORAGE_KEY) || '';

    const charCounter = document.createElement('small');
    charCounter.className = 'supertavern-notes-counter';

    const presetBar = document.createElement('div');
    presetBar.className = 'supertavern-notes-presets';

    const presets = [
        { label: 'Add recap', text: 'Recap: ' },
        { label: 'Add quest', text: 'Quest Hook: ' },
        { label: 'Add warning', text: 'Watch out for: ' },
    ];

    presets.forEach(({ label, text }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu_button';
        button.textContent = label;
        button.addEventListener('click', () => {
            const insert = textarea.selectionStart ?? textarea.value.length;
            const value = textarea.value;
            textarea.value = `${value.slice(0, insert)}${text}${value.slice(insert)}`;
            textarea.dispatchEvent(new Event('input'));
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = insert + text.length;
        });
        presetBar.appendChild(button);
    });

    const updateCounter = () => {
        charCounter.textContent = `${textarea.value.length} characters saved`;
    };

    textarea.addEventListener('input', () => {
        localStorage.setItem(NOTES_STORAGE_KEY, textarea.value);
        updateCounter();
    });

    updateCounter();

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'menu_button supertavern-notes-clear';
    clearButton.textContent = 'Clear notes';
    clearButton.addEventListener('click', () => {
        textarea.value = '';
        textarea.dispatchEvent(new Event('input'));
    });

    notesBlock.append(header, description, presetBar, textarea, charCounter, clearButton);
    scrollable.prepend(notesBlock);
}

function initCharacterFilter() {
    const rightPanel = document.getElementById('right-nav-panel');
    const charactersContainer = document.getElementById('rm_print_characters_block');
    if (!rightPanel || !charactersContainer) {
        return;
    }

    const filterWrapper = document.createElement('div');
    filterWrapper.className = 'supertavern-character-filter';

    const label = document.createElement('label');
    label.className = 'supertavern-filter-label';
    label.innerHTML = '<i class="fa-solid fa-filter"></i><span>Quick filter</span>';

    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'text_pole supertavern-filter-input';
    input.placeholder = 'Type to filter characters instantly';

    const matchCounter = document.createElement('small');
    matchCounter.className = 'supertavern-filter-counter';

    const noResults = document.createElement('div');
    noResults.className = 'supertavern-filter-empty displayNone';
    noResults.textContent = 'No characters match your filter.';

    const applyFilter = () => {
        const query = input.value.trim().toLowerCase();
        let matches = 0;
        const items = charactersContainer.querySelectorAll('.character_select');
        items.forEach((item) => {
            const text = item.textContent?.toLowerCase() || '';
            const isMatch = !query || text.includes(query);
            item.style.display = isMatch ? '' : 'none';
            if (isMatch) {
                matches += 1;
            }
        });

        if (items.length === 0) {
            matchCounter.textContent = 'No characters loaded yet';
        } else {
            matchCounter.textContent = `${matches} / ${items.length} visible`;
        }

        noResults.classList.toggle('displayNone', matches !== 0);
    };

    input.addEventListener('input', applyFilter);

    const observer = new MutationObserver(applyFilter);
    observer.observe(charactersContainer, { childList: true, subtree: true });

    filterWrapper.append(label, input, matchCounter, noResults);

    const pinAndTabs = rightPanel.querySelector('#rm_PinAndTabs');
    if (pinAndTabs) {
        pinAndTabs.after(filterWrapper);
    } else {
        rightPanel.prepend(filterWrapper);
    }
}

function initDraftButtons() {
    const sendForm = document.getElementById('send_form');
    const textarea = document.getElementById('send_textarea');
    const rightSendForm = document.getElementById('rightSendForm');
    if (!sendForm || !textarea || !rightSendForm) {
        return;
    }

    const container = document.createElement('div');
    container.className = 'supertavern-draft-controls';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'menu_button';
    saveButton.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>';
    saveButton.title = 'Save the current draft message';
    saveButton.addEventListener('click', () => {
        const value = textarea.value.trim();
        if (!value) {
            localStorage.removeItem(DRAFT_STORAGE_KEY);
            container.classList.remove('has-draft');
            return;
        }
        localStorage.setItem(DRAFT_STORAGE_KEY, value);
        container.classList.add('has-draft');
    });

    const loadButton = document.createElement('button');
    loadButton.type = 'button';
    loadButton.className = 'menu_button';
    loadButton.innerHTML = '<i class="fa-solid fa-file-import"></i>';
    loadButton.title = 'Load the saved draft into the editor';
    loadButton.addEventListener('click', () => {
        const draft = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (!draft) {
            return;
        }
        textarea.value = draft;
        textarea.dispatchEvent(new Event('input'));
        textarea.focus();
    });

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'menu_button';
    clearButton.innerHTML = '<i class="fa-solid fa-eraser"></i>';
    clearButton.title = 'Clear saved draft';
    clearButton.addEventListener('click', () => {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        container.classList.remove('has-draft');
    });

    const draft = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (draft) {
        container.classList.add('has-draft');
    }

    container.append(saveButton, loadButton, clearButton);
    rightSendForm.appendChild(container);
}

document.addEventListener('DOMContentLoaded', () => {
    initTopBarFeatures();
    initLeftPanelNotes();
    initCharacterFilter();
    initDraftButtons();
});
