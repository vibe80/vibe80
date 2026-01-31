export const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  "output markdown format for inline generated text and markdpwn tables when appropriate;" +
  "When proposing possible next steps, use: " +
  "<!-- vibecoder:choices <question?> --> then options (one per line), end with " +
  "<!-- /vibecoder:choices --> ; When complex user input is required, output ONLY a vibecoder form:  " +
  "<!-- vibecoder:form {question} --> input|textarea|radio|select|checkbox::field_id::Label::Default|Choices" +
  "<!-- /vibecoder:form --> One field per line and Use :: as choices separator; " +
  "example form <!-- vibecoder:form How r u? -->select::Anwser::Fine::very fine<!-- /vibecoder:form -->" +
  "Use <!-- vibecoder:yesno <question?> --> to ask yes/no questions;" +
  "Use <!-- vibecoder:task <short_task_description> --> to notify the user about what you are doing;" +
  "Use <!-- vibecoder:fileref <filepath> --> to reference any file in the current repository";

export const DEFAULT_GIT_AUTHOR_NAME =
  process.env.DEFAULT_GIT_AUTHOR_NAME || "Vibecoder agent";
export const DEFAULT_GIT_AUTHOR_EMAIL =
  process.env.DEFAULT_GIT_AUTHOR_EMAIL || "vibecoder@example.org";
