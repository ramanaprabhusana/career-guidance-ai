    const API = window.location.origin;
    let sessionId = null;
    let cachedProgressItems = [];
    let isWaiting = false;
    let currentPhase = 'orientation';
    let turnNumber = 0;
    let firstMessageSent = false;

    const phaseMap = { orientation: 0, exploration_career: 1, exploration_role_targeting: 2, planning: 3 };
    const phaseDisplayNames = { orientation: 'Profile', exploration_career: 'Explore', exploration_role_targeting: 'Skills', planning: 'Action Plan' };
    let lastSkillsMeta = { totalSkills: 0, ratedCount: 0, skillsAssessed: false, assessmentStatus: 'not_started' };
    const placeholders = {
      orientation: 'Tell me about your professional background...',
      exploration_career: 'What kind of work excites you?',
      exploration_role_targeting: 'How would you rate your experience with this skill?',
      planning: 'Any preferences for your career timeline?',
    };
    const typingMessages = {
      orientation: 'Learning about your background',
      exploration_career: 'Exploring career possibilities',
      exploration_role_targeting: 'Analyzing your skills',
      planning: 'Building your action plan',
    };

    // Fetch live API status on page load
    async function fetchDataSourceStatus() {
      try {
        const res = await fetch(`${API}/api/data-sources`);
        if (!res.ok) return;
        const data = await res.json();
        // Welcome page dots
        setDotStatus('dsDotOnet', data.onet?.connected, data.localData?.connected);
        setDotStatus('dsDotBls', data.bls?.connected);
        setDotStatus('dsDotUsajobs', data.usajobs?.connected);
        // Sidebar dots
        setDotStatus('dotOnet', data.onet?.connected, data.localData?.connected);
        setDotStatus('dotBls', data.bls?.connected);
        setDotStatus('dotUsajobs', data.usajobs?.connected);
      } catch { /* silent */ }
    }

    function setDotStatus(id, connected, hasCache) {
      const dot = document.getElementById(id);
      if (!dot) return;
      dot.style.background = connected ? 'var(--success-light)' : (hasCache ? 'var(--warning)' : 'var(--gap-red)');
    }

    // Defer non-critical API call to after first paint
    requestAnimationFrame(() => fetchDataSourceStatus());

    // --- Returning User Detection ---
    function checkReturningUser() {
      const savedId = localStorage.getItem('careerbot_session_id');
      if (savedId) {
        showResumeDialog(savedId);
      }
    }

    function showResumeDialog(savedId) {
      const overlay = document.createElement('div');
      overlay.id = 'resumeOverlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'resumeHeading');
      dialog.style.cssText = 'background:white;border-radius:16px;padding:32px;max-width:460px;width:90%;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,0.2);';
      // Change 4 (Step 12A): 3-button returning-user modal so users can keep
      // their profile facts while still pivoting direction. "New direction
      // (keep my profile)" calls the server with `restart_pivot: true` so
      // `applyRestartPivot` preserves jobTitle/industry/etc but clears path.
      dialog.innerHTML = `
        <div style="font-size:40px;margin-bottom:12px;">&#128075;</div>
        <h2 id="resumeHeading" style="font-size:20px;margin-bottom:8px;color:#191919;">Welcome Back!</h2>
        <p style="color:#666;margin-bottom:24px;font-size:14px;line-height:1.5;">You have a previous career guidance session. How would you like to proceed?</p>
        <div style="display:flex;flex-direction:column;gap:10px;align-items:stretch;">
          <button id="resumeBtn" onclick="resumeSession('${savedId}')" style="padding:12px 20px;background:#0A66C2;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;text-align:left;">Continue last session<div style="font-size:12px;font-weight:400;opacity:0.85;margin-top:2px;">Resume where we left off</div></button>
          <button id="restartPivotBtn" onclick="startRestartPivotSession()" style="padding:12px 20px;background:#f5f5f5;color:#191919;border:1px solid #E0E0E0;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;text-align:left;">New direction (keep my profile)<div style="font-size:12px;font-weight:400;color:#666;margin-top:2px;">Same background, fresh path</div></button>
          <button id="freshBtn" onclick="startFreshSession()" style="padding:12px 20px;background:white;color:#191919;border:1px solid #E0E0E0;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;text-align:left;">Start completely fresh<div style="font-size:12px;font-weight:400;color:#666;margin-top:2px;">Wipe everything and begin new</div></button>
        </div>
      `;
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      // Focus trap + Escape
      document.getElementById('resumeBtn').focus();
      overlay.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { startFreshSession(); return; }
        if (e.key === 'Tab') {
          const btns = [
            document.getElementById('resumeBtn'),
            document.getElementById('restartPivotBtn'),
            document.getElementById('freshBtn'),
          ];
          const idx = btns.indexOf(document.activeElement);
          if (e.shiftKey) { e.preventDefault(); btns[idx <= 0 ? btns.length - 1 : idx - 1].focus(); }
          else { e.preventDefault(); btns[idx >= btns.length - 1 ? 0 : idx + 1].focus(); }
        }
      });
    }

    // Change 4 (Step 12A): "New direction (keep my profile)" handler.
    // Sends `restart_pivot: true` so the server runs applyRestartPivot,
    // which preserves profile facts but resets path-specific state.
    async function startRestartPivotSession() {
      removeResumeDialog();
      localStorage.removeItem('careerbot_session_id');
      document.getElementById('welcomeScreen').style.display = 'none';
      document.getElementById('inputBar').style.display = 'flex';
      showTyping();
      try {
        if (!navigator.onLine) { removeTyping(); showToast('You appear to be offline. Please check your internet connection.'); return; }
        const uid = localStorage.getItem('careerbot_user_id');
        const res = await fetch(`${API}/api/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: uid, restart_pivot: true }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        sessionId = data.sessionId;
        turnNumber = 0;
        localStorage.setItem('careerbot_session_id', sessionId);
        removeTyping();
        if (data.profileRecap) renderProfileRecap(data.profileRecap);
        addMessage('bot', data.message);
        if (data.suggestions && data.suggestions.length > 0) {
          showSuggestions(data.suggestions);
        }
        updatePhase(data.phase, data.skillsMeta || null);
        document.getElementById('statsBar').classList.add('visible');
        document.getElementById('msgInput').focus();
      } catch (e) {
        removeTyping();
        addMessage('bot', "We're having trouble reaching the server. Please check your connection and refresh the page.");
        showToast('Connection error', true);
      }
    }

    // Change 4 (Step 12B): profile recap card rendered above the chat input
    // for returning sessions. Shows the persisted facts so the user can see
    // what the bot already knows.
    function renderProfileRecap(recap) {
      if (!recap || typeof recap !== 'object') return;
      const existing = document.getElementById('profileRecapCard');
      if (existing) existing.remove();
      const items = [];
      if (recap.jobTitle) items.push(['Current role', recap.jobTitle]);
      if (recap.industry) items.push(['Industry', recap.industry]);
      if (recap.yearsExperience !== null && recap.yearsExperience !== undefined) {
        items.push(['Experience', `${recap.yearsExperience} years`]);
      }
      if (recap.educationLevel) items.push(['Education', recap.educationLevel]);
      if (recap.location) items.push(['Location', recap.location]);
      if (recap.preferredTimeline) items.push(['Timeline', recap.preferredTimeline]);
      if (recap.previousTargetRole) items.push(['Prior target', recap.previousTargetRole]);
      if (items.length === 0) return;
      const card = document.createElement('div');
      card.id = 'profileRecapCard';
      card.style.cssText = 'margin:12px 0;padding:14px 18px;background:#f4f9ff;border:1px solid #cfe2ff;border-radius:12px;font-size:13px;color:#1a1a2e;';
      const header = '<div style="font-weight:600;margin-bottom:8px;color:#0A66C2;">What I already know about you</div>';
      const body = items.map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="color:#666;">${k}</span><span style="font-weight:500;">${v}</span></div>`).join('');
      card.innerHTML = header + body;
      const area = document.getElementById('chatArea');
      if (area) area.appendChild(card);
    }

    function removeResumeDialog() {
      const overlay = document.getElementById('resumeOverlay');
      if (overlay) overlay.remove();
    }

    async function resumeSession(savedId) {
      removeResumeDialog();
      document.getElementById('welcomeScreen').style.display = 'none';
      document.getElementById('inputBar').style.display = 'flex';

      const area = document.getElementById('chatArea');
      showTyping();

      try {
        const res = await fetch(`${API}/api/session/${savedId}/history`);
        if (!res.ok) throw new Error('Session expired');
        const data = await res.json();

        sessionId = savedId;
        turnNumber = data.turnNumber || 0;
        removeTyping();
        document.getElementById('statsBar').classList.add('visible');

        // Restore conversation history
        if (data.conversationHistory && data.conversationHistory.length > 0) {
          for (const msg of data.conversationHistory) {
            if (msg.role === 'user') {
              addMessage('user', msg.content);
            } else if (msg.role === 'assistant' || msg.role === 'bot') {
              addMessage('bot', msg.content);
            }
          }
          addMessage('bot', 'Welcome back! I remember our conversation. Let\'s continue where we left off. What would you like to discuss next?');
        } else {
          addMessage('bot', 'Welcome back! It looks like we were just getting started. How can I help with your career guidance today?');
        }

        updatePhase(data.phase, data.skillsMeta || null);
        document.getElementById('msgInput').focus();
      } catch (e) {
        removeTyping();
        localStorage.removeItem('careerbot_session_id');
        addMessage('bot', 'Your previous session has expired. Let\'s start a new conversation.');
        startNewSession();
      }
    }

    function startFreshSession() {
      removeResumeDialog();
      localStorage.removeItem('careerbot_session_id');
      startSession();
    }

    async function startSession() {
      document.getElementById('welcomeScreen').style.display = 'none';
      document.getElementById('inputBar').style.display = 'flex';

      // Privacy banner
      const area = document.getElementById('chatArea');
      const banner = document.createElement('div');
      banner.className = 'privacy-banner';
      banner.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Your conversation is private and not stored permanently.';
      area.appendChild(banner);

      showTyping();
      await startNewSession();
    }

    async function startNewSession() {
      try {
        if (!navigator.onLine) { removeTyping(); showToast('You appear to be offline. Please check your internet connection.'); return; }
        const uid = localStorage.getItem('careerbot_user_id');
        const res = await fetch(`${API}/api/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(uid ? { userId: uid } : {}),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        sessionId = data.sessionId;
        turnNumber = 0;
        localStorage.setItem('careerbot_session_id', sessionId);
        removeTyping();
        // Change 4: render persona profile recap card when server returns one
        if (data.profileRecap) renderProfileRecap(data.profileRecap);
        addMessage('bot', data.message);
        if (data.suggestions && data.suggestions.length > 0) {
          showSuggestions(data.suggestions);
        } else {
          showSuggestions(['I\'m a software engineer', 'I recently graduated', 'I\'m returning to work', 'I\'m exploring options']);
        }
        updatePhase(data.phase, data.skillsMeta || null);
        document.getElementById('statsBar').classList.add('visible');
        document.getElementById('msgInput').focus();
      } catch (e) {
        removeTyping();
        addMessage('bot', 'We\'re having trouble reaching the server. Please check your connection and refresh the page.');
        showToast('Connection error', true);
      }
    }

    // Check for returning user on page load
    window.addEventListener('DOMContentLoaded', checkReturningUser);

    async function sendMessage(text) {
      const input = document.getElementById('msgInput');
      const msg = text || input.value.trim();
      if (!msg || isWaiting || !sessionId) return;

      // Hide keyboard hint after first message
      if (!firstMessageSent) {
        firstMessageSent = true;
        const hint = document.getElementById('kbHint');
        if (hint) hint.classList.add('hidden');
      }

      input.value = '';
      input.style.height = 'auto';
      removeSuggestions();
      addMessage('user', msg);
      setWaiting(true);
      showTyping();

      if (!navigator.onLine) {
        removeTyping();
        showToast('You appear to be offline. Please check your internet connection.', true);
        setWaiting(false);
        return;
      }

      // Retry logic for timeouts
      let data = null;
      let lastError = null;
      let is404 = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 55000);
          const res = await fetch(`${API}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, message: msg }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.status === 404) { is404 = true; throw new Error('Session not found'); }
          data = await res.json();
          if (data.error) throw new Error(data.error);
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          if (is404) break;
          if (attempt === 0) {
            showToast('This is taking longer than usual. Retrying automatically...');
          }
        }
      }

      removeTyping();

      if (is404) {
        addMessage('bot', 'Your session may have expired. Let\'s start a new conversation.');
        localStorage.removeItem('careerbot_session_id');
        sessionId = null;
        setTimeout(() => { location.reload(); }, 3000);
      } else if (data && !lastError) {
        // Guard against empty bot reply
        const botMsg = (data.message || '').trim();
        if (!botMsg) {
          addMessage('bot', 'I need a moment to organize my thoughts. Could you rephrase your last message?');
        } else {
          addMessage('bot', botMsg);
        }

        turnNumber = data.turnNumber || (turnNumber + 1);
        updatePhase(data.phase, data.skillsMeta || null);
        updateStatsBar(data);
        if (data.progressItems && data.progressItems.length) {
          cachedProgressItems = data.progressItems;
        }

        // Show contextual suggestions from backend
        if (data.suggestions && data.suggestions.length > 0) {
          showSuggestions(data.suggestions);
        } else {
          removeSuggestions();
        }

        if (data.isComplete) {
          showCompletionCard(data.profile);
          // Upgrade export button
          const exportBtn = document.getElementById('exportBtnTop');
          exportBtn.className = 'btn btn-success';
          document.getElementById('exportBtnText').textContent = 'Export Plan';
          exportBtn.title = '';
        }
      } else {
        addMessage('bot', 'The response took longer than expected. This can happen with complex questions. Please try sending your message again.');
        showToast('Please try again', true);
      }

      setWaiting(false);
      input.focus();
    }

    async function exportReport() {
      if (!sessionId) { showToast('Complete a career guidance conversation first to generate your report.'); return; }
      const btn = document.getElementById('exportBtnTop');
      const btnText = document.getElementById('exportBtnText');
      const origText = btnText.textContent;
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btnText.textContent = 'Exporting...';
      btn.classList.add('btn-exporting');

      try {
        const res = await fetch(`${API}/api/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        window.open(`${API}${data.html}`, '_blank');
        showToast('Report opened in a new tab. You can also print it as a PDF.');
      } catch (e) {
        showToast('We could not generate your report right now. Please try again in a moment.', true);
      }

      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btnText.textContent = origText;
      btn.classList.remove('btn-exporting');
    }

    function addMessage(role, text) {
      const area = document.getElementById('chatArea');
      const msg = document.createElement('div');
      msg.className = `msg ${role}`;

      const avatar = document.createElement('div');
      avatar.className = 'msg-avatar';
      avatar.textContent = role === 'bot' ? '\u{1F3AF}' : '\u{1F464}';

      const body = document.createElement('div');
      body.className = 'msg-body';

      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      const sender = document.createElement('span');
      sender.className = 'msg-sender';
      sender.textContent = role === 'bot' ? 'Career Coach' : 'You';
      const time = document.createElement('span');
      time.className = 'msg-time';
      time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      meta.appendChild(sender);
      meta.appendChild(time);

      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      if (role === 'bot') {
        bubble.innerHTML = renderMarkdown(text);
      } else {
        bubble.textContent = text;
      }

      body.appendChild(meta);
      body.appendChild(bubble);
      msg.appendChild(avatar);
      msg.appendChild(body);
      area.appendChild(msg);
      area.scrollTop = area.scrollHeight;
    }

    function renderMarkdown(text) {
      // Escape HTML first
      let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // Bold: **text**
      html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      // Numbered lists: lines starting with "1. ", "2. " etc
      html = html.replace(/(?:^|\n)(\d+\.\s.+(?:\n\d+\.\s.+)*)/g, function(match) {
        const items = match.trim().split('\n').map(l => '<li>' + l.replace(/^\d+\.\s/, '') + '</li>').join('');
        return '\n<ol>' + items + '</ol>';
      });
      // Bullet lists: lines starting with "- " or "* "
      html = html.replace(/(?:^|\n)([-*]\s.+(?:\n[-*]\s.+)*)/g, function(match) {
        const items = match.trim().split('\n').map(l => '<li>' + l.replace(/^[-*]\s/, '') + '</li>').join('');
        return '\n<ul>' + items + '</ul>';
      });
      // Line breaks
      html = html.replace(/\n/g, '<br>');
      // Clean up <br> before/after lists
      html = html.replace(/<br><(ul|ol)/g, '<$1').replace(/<\/(ul|ol)><br>/g, '</$1>');
      return html;
    }

    function showSuggestions(options) {
      removeSuggestions();
      const area = document.getElementById('chatArea');
      const wrap = document.createElement('div');
      wrap.className = 'suggestions';
      wrap.id = 'suggestionsWrap';
      for (const opt of options) {
        const chip = document.createElement('button');
        chip.className = 'suggestion-chip';
        chip.textContent = opt;
        chip.onclick = () => sendMessage(opt);
        wrap.appendChild(chip);
      }
      area.appendChild(wrap);
      area.scrollTop = area.scrollHeight;
    }

    function removeSuggestions() {
      const el = document.getElementById('suggestionsWrap');
      if (el) el.remove();
    }

    function showTyping() {
      const area = document.getElementById('chatArea');
      const msg = document.createElement('div');
      msg.className = 'msg bot';
      msg.id = 'typingMsg';
      const avatar = document.createElement('div');
      avatar.className = 'msg-avatar';
      avatar.textContent = '\u{1F3AF}';
      const body = document.createElement('div');
      body.className = 'msg-body';
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      const sender = document.createElement('span');
      sender.className = 'msg-sender';
      sender.textContent = 'Career Coach';
      meta.appendChild(sender);
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      const typingText = typingMessages[currentPhase] || 'Thinking';
      bubble.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:12px;color:var(--text-muted);">' + typingText + '</span><div class="typing-dots"><span></span><span></span><span></span></div></div>';
      body.appendChild(meta);
      body.appendChild(bubble);
      msg.appendChild(avatar);
      msg.appendChild(body);
      area.appendChild(msg);
      area.scrollTop = area.scrollHeight;
    }

    function removeTyping() {
      const el = document.getElementById('typingMsg');
      if (el) el.remove();
    }

    function updatePhase(phase, skillsMeta) {
      currentPhase = phase;
      if (skillsMeta) lastSkillsMeta = skillsMeta;
      const idx = phaseMap[phase] ?? 0;

      // Update stepper
      const steps = [
        { num: document.getElementById('step1'), step: document.querySelector('[data-phase="orientation"]') },
        { num: document.getElementById('step2'), step: document.querySelector('[data-phase="exploration"]') },
        { num: document.getElementById('step3'), step: document.querySelector('[data-phase="skills"]') },
        { num: document.getElementById('step4'), step: document.querySelector('[data-phase="planning"]') },
      ];

      const lines = [document.getElementById('line1'), document.getElementById('line2'), document.getElementById('line3')];

      const stepNames = ['Profile', 'Explore', 'Skills', 'Action Plan'];
      steps.forEach(({ num, step }, i) => {
        num.classList.remove('active', 'completed');
        step.classList.remove('active', 'completed');
        num.removeAttribute('aria-current');
        if (i < idx) {
          // Skills step (index 2): only mark completed if skills were actually assessed
          if (i === 2 && !lastSkillsMeta.skillsAssessed) {
            num.textContent = '!';
            num.classList.add('completed');
            step.classList.add('completed');
            num.setAttribute('aria-label', `Step ${i+1}: ${stepNames[i]}, incomplete`);
          } else {
            num.classList.add('completed');
            step.classList.add('completed');
            num.innerHTML = '\u2713';
            num.setAttribute('aria-label', `Step ${i+1}: ${stepNames[i]}, completed`);
          }
        } else if (i === idx) {
          num.classList.add('active');
          step.classList.add('active');
          num.textContent = i + 1;
          num.setAttribute('aria-current', 'step');
          num.setAttribute('aria-label', `Step ${i+1}: ${stepNames[i]}, current step`);
        } else {
          num.textContent = i + 1;
          num.setAttribute('aria-label', `Step ${i+1}: ${stepNames[i]}, upcoming`);
        }
      });

      lines.forEach((line, i) => {
        line.classList.toggle('completed', i < idx);
      });

      // Update progress bar
      const pct = Math.round(((idx + 1) / 4) * 100);
      const progressEl = document.getElementById('progressFill');
      progressEl.style.width = pct + '%';
      progressEl.setAttribute('aria-valuenow', pct);
      const labels = ['Building your profile...', 'Exploring career directions...', 'Assessing your skills...', 'Creating your action plan...'];
      document.getElementById('progressLabel').textContent = labels[idx] || labels[0];

      // Update placeholder
      const input = document.getElementById('msgInput');
      if (input) input.placeholder = placeholders[phase] || placeholders.orientation;
    }

    function setWaiting(v) {
      isWaiting = v;
      document.getElementById('sendBtn').disabled = v;
    }

    function handleKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    }

    function showToast(msg, isError) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      const duration = isError ? 5000 : 3500;
      setTimeout(() => t.classList.remove('show'), duration);
    }

    function showComingSoonToast(featureName) {
      showToast(featureName + ' is coming in a future update. Use Career Coach to get started now.');
    }

    function updateStatsBar(data) {
      document.getElementById('statTurn').textContent = 'Turn ' + (data.turnNumber || turnNumber);
      document.getElementById('statPhase').textContent = 'Phase: ' + (phaseDisplayNames[data.phase] || data.phaseDisplay || data.phase);
      const skillsWrap = document.getElementById('statSkillsWrap');
      if (data.phase === 'exploration_role_targeting' && data.profile) {
        skillsWrap.style.display = 'flex';
        // Show skills count if available
        document.getElementById('statSkills').textContent = 'Skills assessment';
      } else {
        skillsWrap.style.display = 'none';
      }
    }

    function showCompletionCard(profile) {
      const area = document.getElementById('chatArea');
      const card = document.createElement('div');
      card.className = 'completion-card';
      const summary = profile?.targetRole
        ? (profile.jobTitle || 'Professional') + ' exploring ' + profile.targetRole
        : 'Exploring career directions';
      card.innerHTML = `
        <div style="font-size:32px;margin-bottom:8px;">&#127942;</div>
        <h3>Your Career Plan is Ready</h3>
        <div class="summary">${summary}</div>
        <div class="card-btns">
          <button class="btn btn-success" onclick="exportReport()">View Full Report</button>
          <button class="btn btn-outline" onclick="this.closest('.completion-card').remove()">Continue Conversation</button>
        </div>
        <div class="privacy-note">Your report contains personal career information. Save it to a secure location.</div>
      `;
      area.appendChild(card);
      area.scrollTop = area.scrollHeight;
    }

    // Scroll-to-bottom button
    function setupScrollButton() {
      const area = document.getElementById('chatArea');
      const btn = document.createElement('button');
      btn.className = 'scroll-bottom-btn';
      btn.id = 'scrollBtn';
      btn.setAttribute('aria-label', 'Scroll to latest message');
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      btn.onclick = () => { area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' }); };
      area.parentElement.appendChild(btn);

      area.addEventListener('scroll', () => {
        const distFromBottom = area.scrollHeight - area.scrollTop - area.clientHeight;
        btn.style.display = distFromBottom > 200 ? 'flex' : 'none';
      });
    }
    setupScrollButton();

    document.getElementById('msgInput')?.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    });

    // ========== VIEW ROUTING ==========
    let currentView = 'chat';
    let dashboardLoaded = false;
    let resourcesLoaded = false;

    function switchView(view) {
      currentView = view;
      // Update nav active state
      document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
      });

      // Hide all views
      document.getElementById('chatArea').style.display = view === 'chat' ? 'flex' : 'none';
      document.getElementById('viewDashboard').classList.toggle('active', view === 'dashboard');
      document.getElementById('viewExplore').classList.toggle('active', view === 'explore');
      document.getElementById('viewResources').classList.toggle('active', view === 'resources');
      document.getElementById('viewEvidence').classList.toggle('active', view === 'evidence');
      document.getElementById('viewProfile').classList.toggle('active', view === 'profile');
      document.getElementById('viewHistory').classList.toggle('active', view === 'history');

      // Input bar only for chat
      const inputBar = document.getElementById('inputBar');
      const kbHint = document.getElementById('kbHint');
      if (view === 'chat') {
        if (sessionId) { inputBar.style.display = 'flex'; }
        if (kbHint) kbHint.style.display = '';
      } else {
        inputBar.style.display = 'none';
        if (kbHint) kbHint.style.display = 'none';
      }

      // Load data on first visit
      if (view === 'dashboard' && !dashboardLoaded) loadDashboard();
      if (view === 'explore') document.getElementById('careerSearchInput')?.focus();
      if (view === 'resources' && !resourcesLoaded) loadResources();
      if (view === 'evidence') loadEvidencePanel();
      if (view === 'profile') loadProfilePanel();
      if (view === 'history') loadHistoryPanel();
    }

    // Keyboard nav for sidebar items
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          switchView(item.dataset.view);
        }
      });
    });

    // ========== EVIDENCE / PROFILE / HISTORY ==========
    async function loadEvidencePanel() {
      const el = document.getElementById('evidenceContent');
      if (!sessionId) {
        el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#x1F4C1;</div><h3>No Session</h3><p>Start a coaching session first.</p><button class="btn btn-primary" onclick="switchView(\'chat\')">Go to Career Coach</button></div>';
        return;
      }
      el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#x23F3;</div><h3>Loading...</h3></div>';
      try {
        const res = await fetch(`${API}/api/session/${sessionId}/evidence`);
        if (!res.ok) throw new Error('load failed');
        const pack = await res.json();
        let html = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">';
        html += '<button type="button" class="btn btn-primary" onclick="exportJsonEvidence()">Download JSON evidence pack</button>';
        html += '</div>';
        html += '<div class="evidence-section"><h3>Summary</h3><p style="color:var(--text-secondary);font-size:14px;">Phase: ' + escapeHtml(pack.phase_display || pack.phase) + ' &middot; Target: ' + escapeHtml(pack.target_role || 'n/a') + '</p></div>';
        if (pack.learning_resources && pack.learning_resources.length) {
          html += '<div class="evidence-section"><h3>Learning resources</h3><ul class="history-list">';
          for (const r of pack.learning_resources) {
            html += '<li><a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener">' + escapeHtml(r.title) + '</a>' + (r.note ? ' <span style="color:var(--text-muted);font-size:13px;">(' + escapeHtml(r.note) + ')</span>' : '') + '</li>';
          }
          html += '</ul></div>';
        }
        if (pack.retrieval_log && pack.retrieval_log.kept && pack.retrieval_log.kept.length) {
          html += '<div class="evidence-section"><h3>Evidence retained</h3><ul class="history-list">';
          for (const k of pack.retrieval_log.kept) {
            html += '<li><strong>' + escapeHtml(k.source) + '</strong>: ' + escapeHtml(k.detail) + ' <em style="color:var(--text-muted);">(' + escapeHtml(k.reason) + ')</em></li>';
          }
          html += '</ul></div>';
        }
        if (pack.retrieval_log && pack.retrieval_log.discarded && pack.retrieval_log.discarded.length) {
          html += '<div class="evidence-section"><h3>Evidence set aside</h3><ul class="history-list">';
          for (const k of pack.retrieval_log.discarded) {
            html += '<li><strong>' + escapeHtml(k.source) + '</strong>: ' + escapeHtml(k.detail) + ' <em style="color:var(--text-muted);">(' + escapeHtml(k.reason) + ')</em></li>';
          }
          html += '</ul></div>';
        }
        html += '<details style="margin-top:16px;"><summary style="cursor:pointer;font-weight:600;">Raw JSON</summary><pre style="overflow:auto;max-height:320px;font-size:11px;background:var(--bg);padding:12px;border-radius:8px;margin-top:8px;">' + escapeHtml(JSON.stringify(pack, null, 2)) + '</pre></details>';
        el.innerHTML = html;
      } catch (e) {
        el.innerHTML = '<div class="empty-state"><h3>Error</h3><p>Could not load evidence pack.</p></div>';
      }
    }

    async function exportJsonEvidence() {
      if (!sessionId) { showToast('Start a session first.'); return; }
      try {
        const res = await fetch(`${API}/api/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, format: 'json' }),
        });
        if (!res.ok) throw new Error('export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'evidence-pack-' + sessionId + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Evidence pack downloaded.');
      } catch (e) {
        showToast('JSON export failed.', true);
      }
    }

    async function loadProfilePanel() {
      const el = document.getElementById('profileContent');
      const savedUid = localStorage.getItem('careerbot_user_id') || '';
      if (!sessionId) {
        el.innerHTML = '<div class="empty-state"><h3>No Session</h3><p>Start a session to see profile and progress.</p><button class="btn btn-primary" onclick="switchView(\'chat\')">Go to Career Coach</button></div>';
        return;
      }
      el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#x23F3;</div><h3>Loading...</h3></div>';
      try {
        const [evRes, sumRes] = await Promise.all([
          fetch(`${API}/api/session/${sessionId}/evidence`),
          fetch(`${API}/api/session/${sessionId}/summary`),
        ]);
        const pack = evRes.ok ? await evRes.json() : {};
        const sum = sumRes.ok ? await sumRes.json() : {};
        let html = '<div class="profile-card-ui" style="background:var(--bg-white);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:20px;">';
        html += '<h3 style="margin-bottom:12px;font-size:16px;">Optional user ID (cross-session)</h3>';
        html += '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;">New sessions started with this ID can load a short summary from the server profile store.</p>';
        html += '<input type="text" id="userIdInput" value="' + escapeHtml(savedUid) + '" placeholder="e.g. my-work-email" style="width:100%;max-width:360px;padding:10px;border:1px solid var(--border);border-radius:8px;margin-right:8px;" /> ';
        html += '<button type="button" class="btn btn-outline" id="saveUserIdBtn">Save</button></div>';

        html += '<div class="profile-card-ui" style="background:var(--bg-white);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:20px;"><h3 style="margin-bottom:12px;">Session profile</h3>';
        html += '<p style="font-size:14px;"><strong>Role:</strong> ' + escapeHtml(sum.profile?.jobTitle || '—') + '</p>';
        html += '<p style="font-size:14px;"><strong>Target:</strong> ' + escapeHtml(sum.profile?.targetRole || '—') + '</p>';
        html += '<p style="font-size:14px;"><strong>Phase:</strong> ' + escapeHtml(sum.phaseDisplay || sum.phase || '—') + '</p></div>';

        const items = (pack.progress_items && pack.progress_items.length) ? pack.progress_items : cachedProgressItems;
        html += '<div class="profile-card-ui" style="background:var(--bg-white);border:1px solid var(--border);border-radius:12px;padding:20px;"><h3 style="margin-bottom:12px;">Progress checklist</h3>';
        if (!items || !items.length) {
          html += '<p style="color:var(--text-secondary);">Progress items appear when you reach the action plan phase.</p>';
        } else {
          html += '<ul style="list-style:none;padding:0;margin:0;">';
          for (const it of items) {
            html += '<li style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);"><label style="display:flex;gap:10px;cursor:pointer;flex:1;"><input type="checkbox" data-pid="' + escapeHtml(it.id) + '" ' + (it.done ? 'checked' : '') + ' /><span style="font-size:14px;">' + escapeHtml(it.label) + '</span></label></li>';
          }
          html += '</ul>';
        }
        html += '</div>';
        el.innerHTML = html;
        const saveBtn = el.querySelector('#saveUserIdBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveUserIdLocal);
        el.querySelectorAll('input[type="checkbox"][data-pid]').forEach((input) => {
          input.addEventListener('change', () => toggleProgressItem(input.getAttribute('data-pid'), input.checked));
        });
      } catch (e) {
        el.innerHTML = '<div class="empty-state"><h3>Error</h3></div>';
      }
    }

    function saveUserIdLocal() {
      const v = document.getElementById('userIdInput').value.trim().slice(0, 128);
      if (v) localStorage.setItem('careerbot_user_id', v);
      else localStorage.removeItem('careerbot_user_id');
      showToast('User ID saved for your next new session.');
    }

    async function toggleProgressItem(id, done) {
      if (!sessionId) return;
      const packRes = await fetch(`${API}/api/session/${sessionId}/evidence`);
      if (!packRes.ok) return;
      const pack = await packRes.json();
      let items = pack.progress_items || cachedProgressItems || [];
      items = items.map((it) => (it.id === id ? { ...it, done } : it));
      cachedProgressItems = items;
      try {
        await fetch(`${API}/api/session/${sessionId}/progress`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });
      } catch { /* ignore */ }
    }

    async function loadHistoryPanel() {
      const el = document.getElementById('historyContent');
      if (!sessionId) {
        el.innerHTML = '<div class="empty-state"><h3>No Session</h3></div>';
        return;
      }
      el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#x23F3;</div><h3>Loading...</h3></div>';
      try {
        const res = await fetch(`${API}/api/session/${sessionId}/history`);
        if (!res.ok) throw new Error('fail');
        const data = await res.json();
        if (!data.conversationHistory || !data.conversationHistory.length) {
          el.innerHTML = '<p style="color:var(--text-secondary);">No messages stored yet.</p>';
          return;
        }
        let html = '<ul class="history-list" style="list-style:none;padding:0;">';
        for (const m of data.conversationHistory) {
          const role = m.role === 'user' ? 'You' : 'Coach';
          html += '<li style="margin-bottom:12px;padding:12px;background:var(--bg-white);border-radius:8px;border:1px solid var(--border);"><strong>' + role + '</strong><div style="margin-top:6px;font-size:14px;white-space:pre-wrap;">' + escapeHtml(m.content || '') + '</div></li>';
        }
        html += '</ul>';
        el.innerHTML = html;
      } catch (e) {
        el.innerHTML = '<div class="empty-state"><h3>Error</h3></div>';
      }
    }

    // ========== SKILLS DASHBOARD ==========
    async function loadDashboard() {
      if (!sessionId) {
        document.getElementById('dashboardEmpty').style.display = '';
        return;
      }

      const container = document.getElementById('dashboardContent');
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#x23F3;</div><h3>Loading dashboard...</h3></div>';

      try {
        const res = await fetch(`${API}/api/session/${sessionId}/summary`);
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        dashboardLoaded = true;

        if (!data.skills || data.skills.length === 0) {
          let emptyMsg = '';
          if (data.assessmentStatus === 'skipped') {
            emptyMsg = 'The skills assessment was skipped in your session. Start a new session and complete the skills assessment to see your skill gaps and strengths.';
          } else if (data.phase === 'planning') {
            emptyMsg = 'Your session reached the planning phase without completing skills assessment. Start a new session to get a full skills analysis.';
          } else {
            emptyMsg = 'Continue your career coaching conversation to reach the skills assessment phase. Your skill gaps and strengths will appear here.';
          }
          container.innerHTML = `
            <div class="empty-state">
              <div class="empty-state-icon">&#x1F4CA;</div>
              <h3>No Skills Assessed Yet</h3>
              <p>${emptyMsg}</p>
              <button class="btn btn-primary" onclick="switchView('chat')">Go to Career Coach</button>
            </div>`;
          return;
        }

        // Update subtitle with target role
        if (data.profile?.targetRole) {
          document.getElementById('dashboardSubtitle').textContent =
            'Skills analysis for ' + data.profile.targetRole;
        }

        const metrics = data.metrics;
        let html = `
          <div class="metrics-row">
            <div class="metric-card">
              <div class="metric-value">${metrics.totalSkills}</div>
              <div class="metric-label">Total Skills</div>
            </div>
            <div class="metric-card warning">
              <div class="metric-value">${metrics.assessed}</div>
              <div class="metric-label">Assessed</div>
            </div>
            <div class="metric-card danger">
              <div class="metric-value">${metrics.gaps}</div>
              <div class="metric-label">Gaps Found</div>
            </div>
          </div>`;

        // Skills table
        html += `<div class="skills-table-wrap"><table class="skills-table">
          <thead><tr>
            <th>Skill</th><th>Source</th><th>Required</th><th>Your Level</th><th>Gap</th>
          </tr></thead><tbody>`;

        for (const s of data.skills) {
          const gapClass = s.gapCategory || 'adequate';
          html += `<tr>
            <td><strong>${escapeHtml(s.name)}</strong></td>
            <td>${s.onetSource ? '<span class="source-tag live">O*NET</span>' : '-'}</td>
            <td>${s.requiredProficiency ?? '-'}</td>
            <td>${s.userRating ?? '-'}</td>
            <td>${s.gapCategory ? '<span class="gap-badge ' + gapClass + '">' + s.gapCategory + '</span>' : '-'}</td>
          </tr>`;
        }
        html += '</tbody></table></div>';

        // Top gaps
        if (metrics.topGaps && metrics.topGaps.length > 0) {
          html += '<div class="top-gaps-section"><h3>Priority Gaps</h3>';
          for (const g of metrics.topGaps) {
            html += `<div class="gap-card">
              <div><span class="gap-skill">${escapeHtml(g.skill)}</span></div>
              <div class="gap-detail">Required: Level ${g.required ?? '?'} &middot; <span class="gap-badge ${g.gap}">${g.gap}</span></div>
            </div>`;
          }
          html += '</div>';
        }

        container.innerHTML = html;
      } catch (e) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">&#x26A0;&#xFE0F;</div>
            <h3>Could Not Load Dashboard</h3>
            <p>${sessionId ? 'There was an error loading your session data.' : 'Start a career coaching session first.'}</p>
            <button class="btn btn-primary" onclick="switchView('chat')">Go to Career Coach</button>
          </div>`;
      }
    }

    // ========== EXPLORE CAREERS ==========
    let searchTimeout = null;

    async function searchCareers() {
      const input = document.getElementById('careerSearchInput');
      const q = input.value.trim();
      const container = document.getElementById('careerResults');
      const meta = document.getElementById('careerResultsMeta');

      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#x23F3;</div><h3>Searching...</h3></div>';
      meta.style.display = 'none';

      try {
        const url = q ? `${API}/api/careers/search?q=${encodeURIComponent(q)}` : `${API}/api/careers/search`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();

        if (!data.results || data.results.length === 0) {
          container.innerHTML = `
            <div class="empty-state">
              <div class="empty-state-icon">&#x1F50D;</div>
              <h3>No Results Found</h3>
              <p>Try a different search term or browse all occupations by clearing the search.</p>
            </div>`;
          return;
        }

        meta.style.display = 'block';
        meta.textContent = data.results.length + ' occupation' + (data.results.length !== 1 ? 's' : '') + ' found' +
          (data.source === 'onet_live' ? ' (live O*NET data)' : ' (local cache)');

        let html = '';
        for (const occ of data.results) {
          const sourceClass = occ.source === 'onet_live' ? 'live' : 'cache';
          const sourceLabel = occ.source === 'onet_live' ? 'Live' : 'Cached';
          html += `<div class="career-card">
            <div class="career-card-info">
              <h4>${escapeHtml(occ.title)}</h4>
              <div class="career-code">${escapeHtml(occ.code)}</div>
              <p>${escapeHtml(occ.description || 'No description available.')}</p>
              <span class="source-tag ${sourceClass}">${sourceLabel}</span>
              ${occ.skillCount ? '<span style="font-size:11px;color:var(--text-muted);margin-left:8px;">' + occ.skillCount + ' skills</span>' : ''}
            </div>
            <div class="career-card-actions">
              <button class="btn btn-outline" onclick="setTargetRole('${escapeHtml(occ.title).replace(/'/g, "\\'")}', '${escapeHtml(occ.code)}')" title="Use this as your target career role">
                Use as Target
              </button>
            </div>
          </div>`;
        }
        container.innerHTML = html;
      } catch (e) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">&#x26A0;&#xFE0F;</div>
            <h3>Search Error</h3>
            <p>Could not reach the career search API. Please try again.</p>
          </div>`;
      }
    }

    async function setTargetRole(title, code) {
      if (!sessionId) {
        showToast('Start a career coaching session first to set a target role.');
        return;
      }
      try {
        const res = await fetch(`${API}/api/session/${sessionId}/target-role`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, code }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Target role set to: ' + title);
          dashboardLoaded = false; // force refresh on next dashboard visit
        } else {
          showToast('Could not set target role.', true);
        }
      } catch {
        showToast('Could not set target role. Please try again.', true);
      }
    }

    // ========== RESOURCES ==========
    let allResources = [];
    let activeResourceFilter = 'all';

    async function loadResources() {
      const container = document.getElementById('resourcesContent');

      try {
        // Build query params from session profile if available
        let queryParams = '';
        if (sessionId) {
          try {
            const sumRes = await fetch(`${API}/api/session/${sessionId}/summary`);
            if (sumRes.ok) {
              const sumData = await sumRes.json();
              const parts = [];
              if (sumData.profile?.targetRole) parts.push('role=' + encodeURIComponent(sumData.profile.targetRole));
              const skillNames = (sumData.skills || []).map(s => s.name).filter(Boolean).slice(0, 5);
              if (skillNames.length) parts.push('skills=' + encodeURIComponent(skillNames.join(',')));
              if (parts.length) queryParams = '?' + parts.join('&');

              if (sumData.profile?.targetRole) {
                document.getElementById('resourcesSubtitle').textContent =
                  'Resources matched to your target role: ' + sumData.profile.targetRole;
              }
            }
          } catch { /* continue without personalization */ }
        }

        const res = await fetch(`${API}/api/resources${queryParams}`);
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        allResources = data.results || [];
        resourcesLoaded = true;
        renderResources(allResources);
      } catch (e) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">&#x26A0;&#xFE0F;</div>
            <h3>Could Not Load Resources</h3>
            <p>Please check your connection and try again.</p>
          </div>`;
      }
    }

    function filterResources(type) {
      activeResourceFilter = type;
      document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.filter === type);
      });
      const filtered = type === 'all' ? allResources : allResources.filter(r => r.type === type);
      renderResources(filtered);
    }

    function renderResources(resources) {
      const container = document.getElementById('resourcesContent');

      if (!resources || resources.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">&#x1F4DA;</div>
            <h3>No Resources Found</h3>
            <p>Try changing your filter or check back later for new resources.</p>
          </div>`;
        return;
      }

      const free = resources.filter(r => r.type === 'free');
      const paid = resources.filter(r => r.type === 'paid');
      let html = '';

      if (free.length > 0) {
        html += `<div class="resource-group-title">Free Resources <span class="resource-group-count">(${free.length})</span></div>`;
        html += '<div class="resource-grid">';
        for (const r of free) html += renderResourceCard(r);
        html += '</div>';
      }

      if (paid.length > 0) {
        html += `<div class="resource-group-title">Paid / Certificate Programs <span class="resource-group-count">(${paid.length})</span></div>`;
        html += '<div class="resource-grid">';
        for (const r of paid) html += renderResourceCard(r);
        html += '</div>';
      }

      container.innerHTML = html;
    }

    function renderResourceCard(r) {
      const typeClass = r.type === 'free' ? 'free' : 'paid';
      const skills = (r.skills || []).slice(0, 3);
      return `<div class="resource-card">
        <h4>${escapeHtml(r.title)}</h4>
        <div class="resource-source">${escapeHtml(r.source)}${r.certification ? ' &middot; <span class="cert-badge">Certificate</span>' : ''}</div>
        <p>${escapeHtml(r.description || '')}</p>
        <div class="resource-card-footer">
          <div class="resource-tags">
            ${skills.map(s => '<span class="resource-tag">' + escapeHtml(s) + '</span>').join('')}
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="resource-type-badge ${typeClass}">${r.type}</span>
            <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="resource-link">Visit &rarr;</a>
          </div>
        </div>
      </div>`;
    }

    function escapeHtml(text) {
      if (!text) return '';
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
