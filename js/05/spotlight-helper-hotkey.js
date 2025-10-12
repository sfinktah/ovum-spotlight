// Hotkey handling and UI-block checks for Spotlight

/**
 * Check if a keyboard event matches a hotkey string like "Ctrl+Shift+K" or "Cmd+Space".
 * @param {KeyboardEvent} event
 * @param {string} hotkeyString
 * @returns {boolean}
 */
export function matchesHotkey (event, hotkeyString) {
    if (!hotkeyString) {
        return false;
    }

    const parts = hotkeyString.toLowerCase().split('+').map(p => p.trim());
    const key = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);

    const hasCtrl = modifiers.includes('ctrl') || modifiers.includes('control');
    const hasMeta = modifiers.includes('meta') || modifiers.includes('cmd') || modifiers.includes('command');
    const hasAlt = modifiers.includes('alt');
    const hasShift = modifiers.includes('shift');

    const eventKey = event.key.toLowerCase();
    const matchesKey = eventKey === key || (key === 'space' && eventKey === ' ');

    return matchesKey &&
        (hasCtrl ? event.ctrlKey : !event.ctrlKey) &&
        (hasMeta ? event.metaKey : !event.metaKey) &&
        (hasAlt ? event.altKey : !event.altKey) &&
        (hasShift ? event.shiftKey : !event.shiftKey);
}

/**
 * CSS selectors for overlays that should block Spotlight from opening.
 * @returns {string[]}
 */
export function getSpotlightBlockSelectors () {
    return [
        // Blur focus for these UI overlays before allowing spotlight to open
        '.ovum-prompt-window-shade',
        '.dialog.buttons',
        '.ovum-sequencer',
        '.ovum-connections',
        '.ovum-spotlight', // if spotlight itself is open, treat as blocking
        '.ovum-keyword-dialog'
    ];
}

/**
 * Returns true if any known overlay element is visible, in which case Spotlight should not open.
 * @returns {boolean}
 */
export function isBlockedByActiveUI () {
    const selectors = getSpotlightBlockSelectors();
    for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        const isVisible = style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        if (isVisible) return true;
    }
    return false;
}
