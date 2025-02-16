export const setupModalFocus = (modalId, submitButtonId, closeButtonId) => {
    const modal = document.getElementById(modalId);
    const submitButton = document.getElementById(submitButtonId);
    const closeButton = document.getElementById(closeButtonId);
    
    if (!modal || !submitButton || !closeButton) return;

    // Get all focusable elements
    const focusableElements = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    // Focus first input or button when modal opens
    const firstInput = modal.querySelector('input') || submitButton;
    firstInput.focus();

    // Handle tab key
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            if (e.shiftKey) {
                if (document.activeElement === firstFocusable) {
                    e.preventDefault();
                    lastFocusable.focus();
                }
            } else {
                if (document.activeElement === lastFocusable) {
                    e.preventDefault();
                    firstFocusable.focus();
                }
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            submitButton.click();
        }
    });
};
