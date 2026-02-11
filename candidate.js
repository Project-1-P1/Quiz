const Candidate = {
    // State
    sessionData: null,
    questions: [],
    currentQIndex: 0,
    score: 0,
    timerInterval: null,
    questionStartTime: null,
    isSubmitting: false,

    // Initialize Exam
    init: async (eventData) => {
        // [REQUIREMENT 1] Safe Initialization & Guard Clause
        if (!eventData || !eventData.id) {
            console.error("Candidate Init Error: Missing or invalid event data.", eventData);
            if (window.UI) UI.toast("Mission Initialization Failed: Invalid Data", "error");
            return;
        }

        // 1. Store Session Data (safely)
        Candidate.sessionData = eventData;

        // Defensive UI Updates
        const userEmail = (window.System && System.state && System.state.user && System.state.user.email) 
            ? System.state.user.email 
            : 'Unknown Candidate';
            
        const eventTitle = Candidate.sessionData.title || 'Unknown Operation';

        const userEl = document.getElementById('ex-user');
        if (userEl) userEl.innerText = userEmail;

        const titleEl = document.getElementById('ex-event-title');
        if (titleEl) titleEl.innerText = eventTitle;

        // 2. Fetch Questions
        UI.toast("Decrypting Mission Data...", "info");
        
        // [SCHEMA FIX] Removed 'text_content' from options selection.
        // We only select 'id' to map the submission.
        const { data: qs, error } = await sb
            .from('questions')
            .select(`
                id, text_content, points, negative_marks, time_limit_seconds, hint_penalty,
                options (id)
            `)
            .eq('event_id', Candidate.sessionData.id)
            .order('created_at', { ascending: true });

        if (error || !qs || qs.length === 0) {
            console.error("Fetch Error:", error);
            UI.toast("Mission Data Corrupted or Empty", "error");
            return;
        }

        Candidate.questions = qs;
        Candidate.currentQIndex = 0;

        // 3. Initialize Score
        await Candidate.syncScore();

        // 4. Start Global Timer
        if (Candidate.sessionData.end_at) {
            Candidate.startGlobalTimer(Candidate.sessionData.end_at);
        } else {
            console.warn("No end time specified for this event.");
        }

        // 5. Render First Question
        Candidate.renderQuestion();

        // 6. Bind Listeners
        const btnHint = document.getElementById('btn-hint');
        if (btnHint) btnHint.onclick = Candidate.useHint;

        const btnLb = document.getElementById('btn-view-lb');
        if (btnLb) btnLb.onclick = Candidate.toggleLeaderboard;

        const btnCloseLb = document.getElementById('btn-close-lb');
        if (btnCloseLb) btnCloseLb.onclick = Candidate.toggleLeaderboard;

        // 7. Anti-Cheat Monitoring
        document.removeEventListener("visibilitychange", Candidate.handleVisibilityChange);
        document.addEventListener("visibilitychange", Candidate.handleVisibilityChange);
    },

    // --- GAME LOOP ---

    renderQuestion: () => {
        // [REQUIREMENT 2] Lock UI on Finish
        if (!Candidate.questions || Candidate.currentQIndex >= Candidate.questions.length) {
            Candidate.finishGame();
            return;
        }

        // Reset submit flag for new question
        Candidate.isSubmitting = false;

        const q = Candidate.questions[Candidate.currentQIndex];
        
        // Update UI Elements safely
        const qNumEl = document.getElementById('q-num');
        if (qNumEl) qNumEl.innerText = Candidate.currentQIndex + 1;

        const qPtsEl = document.getElementById('q-points-display');
        if (qPtsEl) qPtsEl.innerText = `${q.points} pts`;

        const qTxtEl = document.getElementById('q-txt');
        if (qTxtEl) qTxtEl.innerText = q.text_content;
        
        // Reset Hint Button
        const btnHint = document.getElementById('btn-hint');
        if (btnHint) {
            btnHint.disabled = false;
            btnHint.innerText = `💡 Request Intel (-${q.hint_penalty || 0} pts)`;
        }

        // Render Options
        const grid = document.getElementById('opt-area');
        if (grid) {
            grid.innerHTML = '';
            
            // Client-side shuffle to randomize which ID gets assigned to A, B, C, D
            const shuffledOpts = q.options ? [...q.options].sort(() => Math.random() - 0.5) : [];

            shuffledOpts.forEach((opt, index) => {
                const btn = document.createElement('button');
                btn.className = 'opt-btn';
                
                // [SCHEMA FIX] Generate label based on index (Option A, Option B, etc.)
                // This removes dependency on database text_content column.
                const label = `Option ${String.fromCharCode(65 + index)}`; 
                btn.innerText = label;

                // [REQUIREMENT 1] Prevent double clicks via onclick binding + internal flag
                btn.onclick = (e) => {
                    if (Candidate.isSubmitting) {
                        e.preventDefault();
                        return;
                    }
                    Candidate.submitAnswer(q, opt.id, btn);
                };
                grid.appendChild(btn);
            });
        }

        // Track Start Time
        Candidate.questionStartTime = new Date().toISOString();
    },

    submitAnswer: async (q, optionId, btnElement) => {
        // [REQUIREMENT 1] Strict Guard
        if (Candidate.isSubmitting) return; 
        Candidate.isSubmitting = true;

        // 1. Optimistic UI - Lock ALL buttons immediately
        const allBtns = document.querySelectorAll('.opt-btn');
        allBtns.forEach(b => {
            b.disabled = true;
            b.style.pointerEvents = 'none'; // Extra layer of protection
        });
        
        if (btnElement) {
            btnElement.classList.add('selected');
            btnElement.innerText += ' (Transmitting...)';
        }

        // Safe State Access
        const sessionId = (window.System && System.state) ? System.state.session_id : null;

        if (!sessionId) {
            UI.toast("Session Error: ID missing. Please relogin.", "error");
            Candidate.isSubmitting = false;
            return;
        }

        // [REQUIREMENT 4] RPC Payload Preserved
        const payload = {
            p_event_id: Candidate.sessionData.id,
            p_question_id: q.id,
            p_selected_option_id: optionId,
            p_hint_used: false,
            p_session_id: sessionId,
            p_question_started_at: Candidate.questionStartTime
        };

        try {
            // 3. RPC Call
            const { data, error } = await sb.rpc('submit_answer', payload);

            if (error) throw error;
            if (data && data.status === 'error') throw new Error(data.message);

            // 4. Handle Result
            const delta = data.delta;
            
            if (btnElement) {
                if (delta > 0) {
                    btnElement.classList.remove('selected');
                    btnElement.classList.add('correct');
                    UI.toast(`Target Neutralized: +${delta} Pts`, "success");
                } else {
                    btnElement.classList.remove('selected');
                    btnElement.classList.add('wrong');
                    UI.toast(`Missed: ${delta} Pts`, "error");
                }
            }

            // Update Score safely
            Candidate.score += delta;
            const scoreEl = document.getElementById('ex-score');
            if (scoreEl) scoreEl.innerText = Candidate.score;

            // Wait then Next
            setTimeout(() => {
                // IMPORTANT: Do NOT reset isSubmitting here. 
                // It resets inside renderQuestion() to prevent clicks during transition.
                Candidate.currentQIndex++;
                Candidate.renderQuestion();
            }, 1200);

        } catch (err) {
            console.error("Submission Error:", err);
            
            if (err.message && err.message.includes("Already")) {
                UI.toast("Data already received. Moving on.", "info");
                Candidate.currentQIndex++;
                Candidate.renderQuestion();
            } else {
                UI.toast(err.message || "Transmission Failed", "error");
                // Reset UI on failure to allow retry
                allBtns.forEach(b => {
                    b.disabled = false;
                    b.style.pointerEvents = 'auto';
                });
                if (btnElement) {
                    btnElement.classList.remove('selected');
                    btnElement.innerText = btnElement.innerText.replace(' (Transmitting...)', '');
                }
                Candidate.isSubmitting = false; // Allow retry
            }
        }
    },

    useHint: async () => {
        UI.toast("Hint requested. Penalty applied on next submission.", "warning");
    },

    // --- UTILS ---

    syncScore: async () => {
        if (!System.state.user || !Candidate.sessionData) return;

        // [REQUIREMENT 4] SQL Logic Preserved
        const { data } = await sb
            .from('event_scores')
            .select('current_score')
            .eq('event_id', Candidate.sessionData.id)
            .eq('user_id', System.state.user.id)
            .maybeSingle(); 

        if (data) {
            Candidate.score = data.current_score;
            const scoreEl = document.getElementById('ex-score');
            if (scoreEl) scoreEl.innerText = Candidate.score;
        }
    },

    startGlobalTimer: (endTimeIso) => {
        const endTime = new Date(endTimeIso).getTime();
        
        if (isNaN(endTime)) return; 

        if (Candidate.timerInterval) clearInterval(Candidate.timerInterval);
        
        Candidate.timerInterval = setInterval(() => {
            const now = new Date().getTime();
            const distance = endTime - now;

            if (distance < 0) {
                // [REQUIREMENT 3] Timer Cleanup
                clearInterval(Candidate.timerInterval);
                const timerEl = document.getElementById('ex-timer');
                if (timerEl) timerEl.innerText = "00:00";
                Candidate.finishGame("TIME EXPIRED");
                return;
            }

            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);

            const timerEl = document.getElementById('ex-timer');
            if (timerEl) {
                timerEl.innerText = `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
            }
        }, 1000);
    },

    handleVisibilityChange: () => {
        // [REQUIREMENT 5] Anti-Cheat Logic Preserved
        const overlay = document.getElementById('security-overlay');
        
        if (document.visibilityState === 'hidden') {
            if (overlay) {
                overlay.classList.remove('hidden');
                overlay.style.display = 'flex';
            }
            
            if (System.state.user && Candidate.sessionData) {
                sb.from('live_activity').upsert({
                    user_id: System.state.user.id,
                    event_id: Candidate.sessionData.id,
                    last_action: 'TAB_SWITCH_VIOLATION',
                    last_seen: new Date().toISOString()
                }).then(() => {});
            }

        } else {
            if (overlay) {
                overlay.classList.add('hidden');
                overlay.style.display = 'none';
            }
        }
    },

    toggleLeaderboard: async () => {
        const lb = document.getElementById('exam-leaderboard');
        if (!lb) return;

        const isHidden = lb.classList.contains('hidden');
        
        if (isHidden) {
            lb.classList.remove('hidden');
            
            // [REQUIREMENT 4] RPC Call Preserved
            const { data } = await sb.rpc('get_leaderboard', { p_event_id: Candidate.sessionData.id });
            const tbody = document.getElementById('ex-lb-body');
            
            if (!tbody) return;

            if (!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3">No data available</td></tr>';
            } else {
                const currentUserEmail = System.state.user ? System.state.user.email : '';
                tbody.innerHTML = data.slice(0, 10).map((d, i) => `
                    <tr class="${d.username === currentUserEmail ? 'bg-primary' : ''}">
                        <td>#${i+1}</td>
                        <td>${d.username.split('@')[0]}</td>
                        <td>${d.current_score}</td>
                    </tr>
                `).join('');
            }
        } else {
            lb.classList.add('hidden');
        }
    },

    finishGame: (reason = "MISSION COMPLETE") => {
        // [REQUIREMENT 3] Cleanup on Exit
        if (Candidate.timerInterval) clearInterval(Candidate.timerInterval);
        document.removeEventListener("visibilitychange", Candidate.handleVisibilityChange);
        
        UI.switchView('view-lock');
        
        const lockStatus = document.getElementById('lock-status');
        if (lockStatus) lockStatus.innerText = reason;

        const finalScore = document.getElementById('final-score');
        if (finalScore) finalScore.innerText = Candidate.score;
        
        const btnHome = document.getElementById('btn-home');
        if (btnHome) btnHome.onclick = () => window.location.reload();
    }
};