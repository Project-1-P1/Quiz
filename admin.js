const Admin = {
    activeEventId: null,
    pollInterval: null,

    // Initialize Admin Listeners & State
    init: () => {
        // 1. Bind Buttons
        Admin.bind('btn-create-event', Admin.createEvent);
        Admin.bind('btn-add-q', Admin.addQuestion);
        Admin.bind('btn-start-event', Admin.startEvent);
        Admin.bind('btn-refresh-lb', Admin.refreshLeaderboard);
        Admin.bind('btn-advance', Admin.advancePhase); // Ensure this button exists in HTML
        Admin.bind('btn-eliminate', Admin.eliminate);  // Ensure this button exists in HTML
        Admin.bind('admin-logout', System.logout);

        // 2. Load Initial Data
        Admin.loadEvents();
        
        // 3. Start Polling Dashboard (Every 5s)
        Admin.sync();
        Admin.pollInterval = setInterval(Admin.sync, 5000);
        
        // 4. Tab Switch Listener to refresh specific data
        document.querySelectorAll('.admin-nav div').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabId = e.target.dataset.tab; // Ensure HTML uses data-tab attribute or match via ID logic
                
                if (tabId === 'factory') Admin.loadEvents();
                // [Requirement 2] Manager UI reflects latest event on tab switch
                if (tabId === 'manager') Admin.refreshManagerUI(); 
            });
        });

        // Add listener for Factory Dropdown change to sync Active ID
        const eventSelect = document.getElementById('q-target-event');
        if (eventSelect) {
            eventSelect.addEventListener('change', (e) => {
                Admin.activeEventId = e.target.value;
                // [Requirement 1] Sync Manager UI immediately when selection changes
                Admin.refreshManagerUI(); 
            });
        }
    },

    // Helper to bind click events safely
    bind: (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    },

    // -------------------------------------------------------------------------
    // 📊 DASHBOARD & MONITORING
    // -------------------------------------------------------------------------

    sync: async () => {
        // 1. Get Global Counters (O(1) from system_counters)
        const { data: counters } = await sb.from('system_counters').select('*').single();
        if (counters) {
            const totalEl = document.getElementById('st-total');
            if (totalEl) totalEl.innerText = counters.total_players || 0;
            
            const activeEl = document.getElementById('st-active');
            if (activeEl) activeEl.innerText = counters.active_players || 0;
            
            const elimEl = document.getElementById('st-eliminated');
            if (elimEl) elimEl.innerText = counters.eliminated_players || 0;
        }

        // 2. Get Event Specific Metrics (if an event is active/selected)
        if (Admin.activeEventId) {
            const { data: metrics } = await sb.rpc('get_dashboard_metrics', { p_event_id: Admin.activeEventId });
            if (metrics) {
                const stateEl = document.getElementById('st-state');
                if (stateEl) stateEl.innerText = (metrics.event_state || 'UNKNOWN').toUpperCase();
            }
        }

        // 3. Sync Live Monitor (Recent Activity)
        const { data: logs } = await sb.from('live_activity')
            .select('user_id, last_action, last_seen')
            .order('last_seen', { ascending: false })
            .limit(10);
            
        if (logs) {
            const tbody = document.getElementById('monitor-body');
            if (tbody) {
                tbody.innerHTML = logs.map(l => `
                    <tr>
                        <td class="font-mono text-accent">${(l.user_id || 'Unknown').substr(0, 8)}...</td>
                        <td>${l.last_action}</td>
                        <td>${new Date(l.last_seen).toLocaleTimeString()}</td>
                    </tr>
                `).join('');
            }
        }
    },

    // -------------------------------------------------------------------------
    // 🏭 EVENT FACTORY
    // -------------------------------------------------------------------------

    loadEvents: async () => {
        const { data } = await sb.from('events')
            .select('id, title, state')
            .neq('state', 'finished') // Assumption: we only care about active/upcoming events here
            .order('created_at', { ascending: false });

        const select = document.getElementById('q-target-event');
        if (select) {
            select.innerHTML = '<option value="">Select Target Event...</option>' + 
                (data || []).map(e => `<option value="${e.id}" ${e.id === Admin.activeEventId ? 'selected' : ''}>[${e.state.toUpperCase()}] ${e.title}</option>`).join('');
        }
            
        // [Requirement 1] Sync Active Event ID logic
        if (data && data.length > 0) {
            // If no active ID is set, or the current active ID is not in the list (e.g. finished), default to the newest one.
            const currentExists = data.find(e => e.id === Admin.activeEventId);
            if (!Admin.activeEventId || !currentExists) {
                Admin.activeEventId = data[0].id;
            }
            // Update UI to reflect the (potentially new) active ID
            Admin.refreshManagerUI();
        }
    },

    createEvent: async () => {
        const title = document.getElementById('f-title').value;
        // Assumption: HTML inputs for start/end exist and return ISO-compatible strings
        const start = document.getElementById('f-start').value; 
        const end = document.getElementById('f-end').value;

        if (!title || !start || !end) return UI.toast("Title and Timings required", "warning");

        UI.toggleBtnLoading('btn-create-event', true);

        const { data, error } = await sb.from('events').insert({
            title: title,
            state: 'upcoming',
            start_at: new Date(start).toISOString(),
            end_at: new Date(end).toISOString(),
            ip_binding_enabled: document.getElementById('f-ip-bind').checked,
            session_binding_enabled: document.getElementById('f-session-bind').checked,
            auto_eliminate_on_ip_change: document.getElementById('f-auto-ban').checked,
            hint_system_enabled: document.getElementById('f-hints').checked,
            max_hints_allowed: 3
        }).select().single();

        UI.toggleBtnLoading('btn-create-event', false);

        if (error) {
            UI.toast("Creation Failed: " + error.message, "danger");
        } else {
            UI.toast(`Operation '${title}' Initialized`, "success");
            // [Requirement 1] Automatically switch focus to new event
            Admin.activeEventId = data.id;
            Admin.loadEvents(); // Reloads list and selects the new ID via the logic in loadEvents
            
            // Clear inputs
            document.getElementById('f-title').value = '';
        }
    },

    addQuestion: async () => {
        const eventId = document.getElementById('q-target-event').value;
        const text = document.getElementById('q-text').value;
        const correctIdx = document.getElementById('q-correct').value;
        
        if (!eventId || !text || !correctIdx) return UI.toast("Missing Event, Question text, or Correct Option", "warning");

        UI.toggleBtnLoading('btn-add-q', true);

        // 1. Insert Question
        const { data: q, error: qErr } = await sb.from('questions').insert({
            event_id: eventId,
            text_content: text,
            points: parseInt(document.getElementById('q-points').value) || 10,
            negative_marks: parseInt(document.getElementById('q-neg').value) || 0,
            hint_penalty: parseInt(document.getElementById('q-hint-pen').value) || 2,
            time_limit_seconds: parseInt(document.getElementById('q-time').value) || 0
        }).select().single();

        if (qErr) {
            UI.toggleBtnLoading('btn-add-q', false);
            return UI.toast("Question Error: " + qErr.message, "danger");
        }

        // 2. Insert Options
        const optsInput = document.querySelectorAll('.q-opt');
        
        // [SCHEMA FIX] Removed 'text_content' from payload.
        // We only insert 'question_id' and 'is_correct'.
        const optionsPayload = Array.from(optsInput).map(input => ({
            question_id: q.id,
            is_correct: (input.dataset.idx === correctIdx) // Ensure HTML uses data-idx="0", "1", etc.
        }));

        const { error: oErr } = await sb.from('options').insert(optionsPayload);

        UI.toggleBtnLoading('btn-add-q', false);

        if (oErr) {
            UI.toast("Options Error: " + oErr.message, "danger");
        } else {
            UI.toast("Payload Uploaded to Bank", "success");
            // Reset Fields
            document.getElementById('q-text').value = '';
            optsInput.forEach(i => i.value = '');
        }
    },

    // -------------------------------------------------------------------------
    // ⚙️ ROUND MANAGER
    // -------------------------------------------------------------------------

    // [Requirement 2] Renamed to refreshManagerUI to clarify it pulls data for the ACTIVE event
    refreshManagerUI: async () => {
        if (!Admin.activeEventId) {
            const titleEl = document.getElementById('mgr-event-title');
            if (titleEl) titleEl.innerText = "No Active Operations";
            return;
        }

        // Fetch details for the *specifically selected* event
        const { data: event } = await sb.from('events')
            .select('*')
            .eq('id', Admin.activeEventId)
            .single();

        if (event) {
            const titleEl = document.getElementById('mgr-event-title');
            if (titleEl) titleEl.innerText = event.title;
            
            const idEl = document.getElementById('mgr-event-id');
            if (idEl) idEl.innerText = event.id;
            
            const btnStart = document.getElementById('btn-start-event');
            if (btnStart) {
                if (event.state === 'live') {
                    btnStart.innerText = "🟢 SYSTEM IS LIVE";
                    btnStart.disabled = true;
                    btnStart.classList.replace('btn-success', 'btn-outline');
                } else {
                    btnStart.innerText = "🚀 GO LIVE (Pre-Warm)";
                    btnStart.disabled = false;
                    btnStart.classList.replace('btn-outline', 'btn-success');
                }
            }
        }
    },

    // Legacy method kept for compatibility if called elsewhere, but delegates to refreshManagerUI
    checkActiveEvent: async () => {
        // Only run if we don't have an active ID, otherwise trust the user's selection
        if (!Admin.activeEventId) {
            const { data } = await sb.from('events')
                .select('id')
                .neq('state', 'finished')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            
            if (data) Admin.activeEventId = data.id;
        }
        Admin.refreshManagerUI();
    },

    // RPC: Start Event (Pre-Warming)
    startEvent: async () => {
        if (!Admin.activeEventId) return UI.toast("No event selected", "warning");
        if (!confirm("⚠️ LAUNCH WARNING ⚠️\n\nThis will PRE-WARM score rows and enable live access.\nConfirm launch?")) return;

        UI.toggleBtnLoading('btn-start-event', true);
        
        const { data, error } = await sb.rpc('start_event', { p_event_id: Admin.activeEventId });
        
        UI.toggleBtnLoading('btn-start-event', false);

        if (error) {
            UI.toast("Launch Aborted: " + error.message, "danger");
        } else {
            // Check data integrity before accessing properties
            const playersReady = data ? data.players_ready : '?';
            UI.toast(`🚀 Event LIVE! ${playersReady} agents ready.`, "success");
            Admin.refreshManagerUI(); // Refresh UI
        }
    },

    // RPC: Advance Phase (State Machine)
    advancePhase: async () => {
        if (!Admin.activeEventId) return UI.toast("No event selected", "warning");
        if (!confirm("Advance event state? (Live -> Finished -> Next)")) return;
        
        const { error } = await sb.rpc('advance_event', { p_current_event_id: Admin.activeEventId });
        if (error) UI.toast(error.message, "danger");
        else {
            UI.toast("Phase Advanced", "success");
            Admin.refreshManagerUI();
        }
    },

    // RPC: Eliminate
    eliminate: async () => {
        if (!Admin.activeEventId) return UI.toast("No event selected", "warning");
        const confirmStr = prompt("Type 'EXECUTE' to confirm mass elimination based on threshold:");
        if (confirmStr !== 'EXECUTE') return;

        const { data: count, error } = await sb.rpc('apply_elimination', { p_event_id: Admin.activeEventId });
        if (error) UI.toast(error.message, "danger");
        else UI.toast(`${count} Agents Eliminated`, "warning");
    },

    // -------------------------------------------------------------------------
    // 🏆 LEADERBOARD
    // -------------------------------------------------------------------------

    refreshLeaderboard: async () => {
        if (!Admin.activeEventId) return;

        // Use the Cache RPC (reads from leaderboard_cache table)
        const { data: lb } = await sb.rpc('get_leaderboard', { p_event_id: Admin.activeEventId });
        
        const tbody = document.getElementById('admin-lb-body');
        if (tbody) {
            if (!lb || lb.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center">No data available</td></tr>';
                return;
            }

            tbody.innerHTML = lb.map((entry, i) => `
                <tr>
                    <td>#${i+1}</td>
                    <td class="font-bold">${entry.username}</td>
                    <td class="text-accent">${entry.current_score}</td>
                    <td>${entry.questions_answered} Qs</td>
                </tr>
            `).join('');
            
            UI.toast("Rankings Synced");
        }
    }
};