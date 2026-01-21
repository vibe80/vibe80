export const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  "output markdown format for inline generated text;When proposing possible next steps, use: <!-- vibecoder:choices <question?> --> then options (one per line), end with <!-- /vibecoder:choices -->";
