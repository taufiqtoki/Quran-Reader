export const showToast = (message) => {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        console.warn('Toast container not found');
        return;
    }
    
    toastContainer.innerHTML = '';
    const toast = document.createElement('div');
    toast.className = 'toast bg-green-500 text-white px-4 py-2 rounded shadow-md';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                toast.remove();
            }, 500);
        }, 3000);
    }, 100);
};
