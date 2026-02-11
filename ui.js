const UI = {
    // Switch between main views (Login, Lobby, Admin, Exam)
    switchView: (viewId) => {
        document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
        const target = document.getElementById(viewId);
        if (target) target.classList.remove('hidden');
    },
    
    // Switch between Admin Tabs (Dashboard, Factory, etc.)
    showTab: (tabId) => {
        // Hide all tab content
        document.querySelectorAll('#admin-main > div').forEach(d => d.classList.add('hidden'));
        
        // Show selected tab content
        const content = document.getElementById('tab-' + tabId);
        if (content) content.classList.remove('hidden');

        // Update Nav Active State using data-tab attribute
        document.querySelectorAll('.admin-nav div').forEach(d => d.classList.remove('active'));
        const activeNav = document.querySelector(`.admin-nav div[data-tab="${tabId}"]`);
        if (activeNav) activeNav.classList.add('active');
    },

    // Toast Notification System
    toast: (msg, type = 'success') => {
        const t = document.createElement('div'); 
        
        // Use CSS classes: toast success, toast error, toast warning
        t.className = `toast ${type}`; 
        t.innerText = msg;
        
        const container = document.getElementById('toast-container');
        if (container) {
            container.appendChild(t);
            // Remove after animation (3s)
            setTimeout(() => t.remove(), 3000);
        }
    },

    // Helper: Toggle Button Loading State
    toggleBtnLoading: (btnId, isLoading) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        
        if (isLoading) {
            btn.dataset.originalText = btn.innerText;
            btn.innerText = '...';
            btn.disabled = true;
        } else {
            btn.innerText = btn.dataset.originalText || 'Submit';
            btn.disabled = false;
        }
    },

    // [New Requirement 1 & 2] Safe Transition to Exam
    startExam: (eventData) => {
        // 1. Validate Event Data
        if (!eventData || !eventData.id) {
            console.error("UI Error: Attempted to start exam with invalid data.", eventData);
            UI.toast("Unable to launch mission: Data corrupted.", "error");
            return;
        }

        // 2. Validate Candidate Module
        if (!window.Candidate || typeof Candidate.init !== 'function') {
            console.error("UI Error: Candidate module not loaded.");
            UI.toast("System Error: Exam module missing.", "error");
            return;
        }

        // 3. Perform Transition
        UI.switchView('view-exam');
        
        // 4. Initialize Exam Logic
        Candidate.init(eventData);
    }
};