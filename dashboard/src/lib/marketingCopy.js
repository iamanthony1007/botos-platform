// The five-step flow, verbatim the CAPTIONS sequence the DmThread walkthrough
// steps through on /how-it-works. Single source: the landing FlowStrip and the
// DmThread both import this. Lives in lib/ (not MarketingSections.jsx) because
// react-refresh/only-export-components forbids constant exports from component
// files.
export const FLOW_STEPS = [
  'A lead sends the first DM.',
  'MU AI drafts a reply in seconds and holds it for review.',
  'Your setter approves it. A human stays in the loop.',
  'The reply sends.',
  'No reply after 20 hours, so MU AI follows up on its own.'
]
