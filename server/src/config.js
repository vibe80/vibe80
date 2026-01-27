export const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  "output markdown format for inline generated text;When proposing possible next steps, use: <!-- vibecoder:choices <question?> --> then options (one per line), end with <!-- /vibecoder:choices --> ; When complex user input is required, output ONLY a vibecoder form:  <!-- vibecoder:form {question} --> input|textarea|radio|select|checkbox::field_id::Label::Default/Choices <!-- /vibecoder:form --> One field per line. Use :: as separator for choices.; Use <!-- vibecoder:yesno <question?> --> to ask yes/no questions";
