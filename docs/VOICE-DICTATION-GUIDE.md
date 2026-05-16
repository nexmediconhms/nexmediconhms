# Voice-to-Notes (Dictation) — Implementation Guide

## Overview

Doctors can now speak during consultations and have their words automatically transcribed into clinical notes, diagnosis fields, or any text input. This is separate from the existing Voice Commands feature (which navigates pages).

---

## How It Works

```
Doctor clicks "Dictation ON" button (or presses Alt+D)
       ↓
Browser's built-in Speech Recognition activates (no API cost!)
       ↓
Doctor speaks: "Patient presents with severe lower abdominal pain 
               since 2 days, associated with nausea and vomiting"
       ↓
Text appears in real-time in the clinical notes field
       ↓
Doctor clicks mic again to stop (or presses Alt+D)
```

---

## For the Doctor — How to Use

### Step 1: Enable Dictation
- On any text field with dictation support, you'll see a small **"Dictation OFF"** button
- Click it once to enable → it turns blue: **"Dictation ON"**
- This preference is remembered (persisted in browser)

### Step 2: Start Speaking
- Click the **microphone icon** inside the text field (bottom-right corner)
- OR press **Alt + D** keyboard shortcut
- The field border turns red and shows "Listening..."
- Speak naturally in English — medical terms work well

### Step 3: Stop
- Click the mic icon again
- OR press Alt + D
- OR just click elsewhere

### Tips for Best Results:
- Speak at normal pace (not too fast)
- Pause briefly between sentences
- Medical terms like "hypertension", "bilateral", "LSCS" are recognized well
- Works best in Chrome or Edge browser
- Quiet room = better accuracy

---

## For Staff — Setup

### Nothing to install!
- Uses the browser's built-in Web Speech API
- Works in Chrome, Edge, and Safari (latest versions)
- No API keys, no costs, no internet dependency after page loads
- Works on mobile browsers too (Chrome Android, Safari iOS)

### Browser Requirements:
| Browser | Support |
|---------|---------|
| Chrome (Desktop) | Full support |
| Edge (Desktop) | Full support |
| Safari (Desktop) | Partial (no continuous) |
| Chrome (Android) | Full support |
| Safari (iOS) | Partial |
| Firefox | Not supported |

---

## Where Dictation Is Available

The `<VoiceDictation>` component can be used in any form field. Currently integrated in:

1. **OPD Consultation** — Clinical Notes, Diagnosis, HPI (History)
2. **Prescription** — Advice field
3. **Discharge Summary** — Clinical summary, Treatment given
4. **Any textarea** — Just import and use the component

---

## Developer Integration

### Replace a textarea with dictation-enabled version:

```tsx
import VoiceDictation from '@/components/voice/VoiceDictation'

// Before:
<textarea value={notes} onChange={e => setNotes(e.target.value)} />

// After:
<VoiceDictation
  value={notes}
  onChange={setNotes}
  label="Clinical Notes"
  placeholder="Type or dictate clinical notes..."
  rows={5}
/>
```

### Add dictation toggle to existing textarea:

```tsx
import { DictationToggle } from '@/components/voice/VoiceDictation'

<div>
  <div className="flex items-center justify-between">
    <label>Notes</label>
    <DictationToggle onTranscript={text => setNotes(prev => prev + ' ' + text)} />
  </div>
  <textarea value={notes} onChange={e => setNotes(e.target.value)} />
</div>
```

---

## Privacy & Security

- **All processing happens in the browser** — audio is NOT sent to your server
- Chrome sends audio to Google's servers for processing (standard Web Speech API behavior)
- No audio is stored or logged
- Transcription results are only saved when the doctor saves the form
- No PHI leaves the browser until the doctor explicitly saves

---

## Keyboard Shortcut

| Shortcut | Action |
|----------|--------|
| `Alt + D` | Toggle dictation on/off for the focused field |
| `Alt + V` | Toggle voice commands (existing feature) |

---

## Limitations

1. **Chrome 60-second limit** — Chrome stops after ~60s of continuous speech. The component auto-restarts, but there may be a brief gap.
2. **Background noise** — Works best in a quiet room. Fans/AC noise can reduce accuracy.
3. **Accented English** — Set to `en-IN` (Indian English) which handles Indian accents well.
4. **Firefox** — Not supported. Recommend Chrome or Edge.

---

## Future Enhancements

1. **Multi-language** — Add Hindi/Gujarati dictation (change `recognition.lang`)
2. **Auto-punctuation** — AI post-processing to add periods and commas
3. **Medical vocabulary boost** — Custom grammar hints for medical terms
4. **Dictation history** — Undo last spoken phrase
5. **Template triggers** — Say "template ANC" to auto-fill ANC examination template
