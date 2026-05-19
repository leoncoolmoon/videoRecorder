/**
 * keyboard.js — All keyboard shortcuts
 */

const Keyboard = (() => {
  // Frame movement acceleration
  let _arrowHeld      = false;
  let _arrowDir       = 0;    // -1 | +1
  let _arrowSpeed     = 1;    // current speed in frames
  let _arrowRafId     = null;
  let _arrowHeldStart = 0;

  const MAX_SPEED_FRACTION = 1 / 20; // max frames = totalFrames / 20

  function init() {
    document.addEventListener('keydown', _onKeyDown);
    document.addEventListener('keyup',   _onKeyUp);
    console.info('[Keyboard] Initialized.');
  }

  function _onKeyDown(e) {
    // Ignore when typing in inputs / contenteditable
    const tag = document.activeElement?.tagName;
    if (['INPUT','TEXTAREA','SELECT'].includes(tag)) return;
    if (document.activeElement?.isContentEditable) return;

    const key  = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    switch (key) {
      // ── Recording ──────────────────────────────
      case 'Enter':
        e.preventDefault();
        if (State.get('isRecording') && !State.get('isPaused')) {
          Recorder.pause();
        } else {
          Recorder.start();
        }
        break;

      // ── Add Tag ────────────────────────────────
      case ' ':
        e.preventDefault();
        if (e.getModifierState && e.getModifierState('Insert') || _insertHeld) {
          // Insert+Space = overwrite mode
          State.set('mode', 'overwrite');
          Recorder.start();
        } else {
          Tags.add(State.get('playhead'));
        }
        break;

      // ── Playhead arrow move ────────────────────
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        if (!_arrowHeld || _arrowDir !== (key === 'ArrowRight' ? 1 : -1)) {
          _arrowHeld      = true;
          _arrowDir       = key === 'ArrowRight' ? 1 : -1;
          _arrowSpeed     = 1;
          _arrowHeldStart = performance.now();
          _stopArrowRaf();
          if (shift) {
            _stepSelectionArrow(_arrowDir);
          } else {
            _stepPlayhead(_arrowDir);
            _startArrowRaf(shift);
          }
        }
        break;

      // ── Playback ───────────────────────────────
      case 'p':
      case 'P':
        e.preventDefault();
        if (State.get('isPlaying')) { Player.pause(); }
        else { Player.play(); }
        break;

      // ── Home / End ─────────────────────────────
      case 'Home':
        e.preventDefault();
        State.set('playhead', 0);
        State.emit('player:seek', 0);
        break;
      case 'End':
        e.preventDefault();
        const dur = State.get('totalDuration');
        State.set('playhead', dur);
        State.emit('player:seek', dur);
        break;

      // ── Delete selection ───────────────────────
      case 'Delete':
      case 'Backspace':
        if (key === 'Backspace' && !ctrl) break; // allow normal backspace
        e.preventDefault();
        {
          const sel = State.get('selection');
          if (sel) {
            Layers.deleteRange(sel.startTime, sel.endTime);
            Tags.clearSelection();
          }
        }
        break;

      // ── Save ───────────────────────────────────
      case 's':
        if (ctrl) {
          e.preventDefault();
          Project.save().then(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'project.zip';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          });
        }
        break;

      // ── Undo (stub) ────────────────────────────
      case 'z':
        if (ctrl) { e.preventDefault(); console.info('[Keyboard] Undo (not yet implemented)'); }
        break;
    }
  }

  let _insertHeld = false;
  document.addEventListener('keydown', e => { if (e.key === 'Insert') _insertHeld = true; });
  document.addEventListener('keyup',   e => {
    if (e.key === 'Insert') _insertHeld = false;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      _arrowHeld = false;
      resetFrameMoveSpeed();
      _stopArrowRaf();
    }
  });

  function _onKeyUp(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      _arrowHeld = false;
      resetFrameMoveSpeed();
      _stopArrowRaf();
    }
  }

  function _stepPlayhead(dir) {
    const fps   = State.get('project')?.meta?.fps || 30;
    const frame = 1 / fps;
    const cur   = State.get('playhead');
    const next  = Math.max(0, cur + dir * frame * _arrowSpeed);
    State.set('playhead', next);
    State.emit('player:seek', next);
    Player.renderOverlay(next);
  }

  function _stepSelectionArrow(dir) {
    const fps   = State.get('project')?.meta?.fps || 30;
    const delta = (1 / fps) * _arrowSpeed;
    Tags.selectShiftArrow(dir > 0 ? 'right' : 'left', delta);
  }

  function _startArrowRaf(shift) {
    const fps      = State.get('project')?.meta?.fps || 30;
    const maxSpeed = Math.max(1, (State.get('totalDuration') * fps) * MAX_SPEED_FRACTION);

    function tick() {
      if (!_arrowHeld) return;
      // Linearly increase speed over 2 seconds
      const held = (performance.now() - _arrowHeldStart) / 1000;
      _arrowSpeed = Math.min(maxSpeed, 1 + held * held * 10);

      if (shift) _stepSelectionArrow(_arrowDir);
      else _stepPlayhead(_arrowDir);

      _arrowRafId = requestAnimationFrame(tick);
    }
    _arrowRafId = requestAnimationFrame(tick);
  }

  function _stopArrowRaf() {
    if (_arrowRafId) { cancelAnimationFrame(_arrowRafId); _arrowRafId = null; }
  }

  function getFrameMoveSpeed() { return _arrowSpeed; }
  function resetFrameMoveSpeed() { _arrowSpeed = 1; }

  return { init, getFrameMoveSpeed, resetFrameMoveSpeed };
})();

window.Keyboard = Keyboard;
