import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  "output markdown format for inline generated text;" +
  "Reference files using relative paths when possible; " +
  "When proposing possible next steps, use: " +
  "<!-- vibe80:choices <question?> --> then options (one per line), end with " +
  "<!-- /vibe80:choices --> ; When complex user input is required, output ONLY a vibe80 form:  " +
  "<!-- vibe80:form {question} --> input|textarea|radio|select|checkbox::field_id::Label::Default|Choices" +
  "<!-- /vibe80:form --> One field per line and Use :: as choices separator; " +
  "example form <!-- vibe80:form How r u? -->select::Anwser::Fine::very fine<!-- /vibe80:form -->" +
  "Use <!-- vibe80:yesno <question?> --> to ask yes/no questions;" +
  "Use <!-- vibe80:task <short_task_description> --> to notify the user about what you are doing;" +
  "Use <!-- vibe80:fileref <filepath> --> to reference any file in the current repository";

export const DEFAULT_GIT_AUTHOR_NAME =
  process.env.DEFAULT_GIT_AUTHOR_NAME || "Vibe80 agent";
export const DEFAULT_GIT_AUTHOR_EMAIL =
  process.env.DEFAULT_GIT_AUTHOR_EMAIL || "vibe80@example.org";

export const GIT_HOOKS_DIR = process.env.VIBE80_GIT_HOOKS_DIR
  || path.resolve(__dirname, "../../git_hooks");
