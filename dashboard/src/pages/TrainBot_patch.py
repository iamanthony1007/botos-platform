"""
Patch script for TrainBot.jsx
Run from: C:\\Users\\Order Account\\botos-platform\\dashboard\\src\\pages\\

Usage:
  python TrainBot_patch.py TrainBot.jsx
"""
import sys, os

if len(sys.argv) < 2:
    print("Usage: python TrainBot_patch.py TrainBot.jsx")
    sys.exit(1)

path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

changes = 0

# ── Fix 1: Initialise messages from localStorage ──────────────────────────────
old_state = """  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')"""

new_state = """  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('trainbot_messages')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {}
    return []
  })
  const [input, setInput] = useState('')"""

if old_state in content:
    content = content.replace(old_state, new_state)
    print("✓ messages state initialised from localStorage")
    changes += 1
else:
    print("✗ messages state not found")

# ── Fix 2: Persist messages to localStorage on every change ────────────────────
old_effect = """  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])"""

new_effect = """  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Persist messages so navigation away doesn't wipe pending changes
  useEffect(() => {
    if (messages.length === 0) return
    try { localStorage.setItem('trainbot_messages', JSON.stringify(messages)) } catch {}
  }, [messages])"""

if old_effect in content:
    content = content.replace(old_effect, new_effect)
    print("✓ localStorage persist effect added")
    changes += 1
else:
    print("✗ scroll effect not found")

# ── Fix 3: Clear localStorage after applying a change ─────────────────────────
old_apply = """    setMessages(prev => prev.map((m, i) => i === msgIdx ? { ...m, type: 'applied' } : m))
    showToast('Prompt updated and live — bot will use this on the next message', 'success')"""

new_apply = """    setMessages(prev => prev.map((m, i) => i === msgIdx ? { ...m, type: 'applied' } : m))
    try { localStorage.removeItem('trainbot_messages') } catch {}
    showToast('Prompt updated and live — bot will use this on the next message', 'success')"""

if old_apply in content:
    content = content.replace(old_apply, new_apply)
    print("✓ localStorage cleared after applying change")
    changes += 1
else:
    print("✗ applyChange toast not found")

# ── Fix 4: On initial load, only reset to welcome message if NO saved messages ─
old_load = """    if (data) {
      setBot(data)
      setMessages([{
        role: 'system',
        text: `Hey! I'm your prompt trainer. Tell me in plain English how you want the bot to behave and I'll update it automatically.\\n\\nExamples:\\n• "Change the greeting to say Hey, thanks for following"\\n• "The bot is too formal, make it more casual"\\n• "Never ask about distance first, always start with pain"\\n• "Add a rule: if someone mentions surgery, slow down and show more empathy"`
      }])
    }"""

new_load = """    if (data) {
      setBot(data)
      // Only set the welcome message if there's nothing saved — otherwise restore saved state
      setMessages(prev => {
        if (prev.length > 0) return prev
        return [{
          role: 'system',
          text: `Hey! I'm your prompt trainer. Tell me in plain English how you want the bot to behave and I'll update it automatically.\\n\\nExamples:\\n• "Change the greeting to say Hey, thanks for following"\\n• "The bot is too formal, make it more casual"\\n• "Never ask about distance first, always start with pain"\\n• "Add a rule: if someone mentions surgery, slow down and show more empathy"`
        }]
      })
    }"""

if old_load in content:
    content = content.replace(old_load, new_load)
    print("✓ loadBot only sets welcome if no saved state")
    changes += 1
else:
    print("✗ loadBot block not found")

# ── Fix 5: Add a Clear button so Nella can manually reset if needed ────────────
old_header = """      <div className="page-header">
        <div>
          <div className="page-title">AI Beha"""

new_header = """      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="page-title">AI Beha"""

# Only patch the title area to add the clear button after it
old_clear_area = """          <div className="page-title">AI Behavior</div>
          <div className="page-sub">Define how the AI should respond and behave across all conversations.</div>"""

new_clear_area = """          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="page-title">AI Behavior</div>
            <button onClick={() => {
              setMessages([])
              try { localStorage.removeItem('trainbot_messages') } catch {}
            }} style={{ fontSize: '.72rem', padding: '3px 10px', borderRadius: '999px', background: 'var(--surf2)', border: '1px solid var(--bdr)', color: 'var(--tx3)', cursor: 'pointer' }}>🗑 Clear</button>
          </div>
          <div className="page-sub">Define how the AI should respond and behave across all conversations.</div>"""

if old_clear_area in content:
    content = content.replace(old_clear_area, new_clear_area)
    print("✓ Clear button added to header")
    changes += 1
else:
    print("✗ page title area not found — skipping clear button")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"\n{'='*40}")
print(f"{changes} changes applied to {path}")
print("\nNow rebuild and deploy:")
print('  cd "C:\\Users\\Order Account\\botos-platform\\dashboard"')
print('  npm run build')
print('  wrangler pages deploy dist --project-name=botos-platform')
