import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const LANGUAGE_STORAGE_KEY = "uiLanguage";

const translations = {
  en: {
    "Oui": "Yes",
    "Non": "No",
    "Annuler": "Cancel",
    "Créer": "Create",
    "Fermer": "Close",
    "Envoyer": "Send",
    "Copier": "Copy",
    "Copier le code": "Copy code",
    "Formulaire": "Form",
    "Ouvrir le formulaire": "Open form",
    "Traitement en cours...": "Processing...",
    "Diff du worktree": "Worktree diff",
    "Diff du repository": "Repository diff",
    "Aucun changement detecte.": "No changes detected.",
    "Explorateur": "Explorer",
    "Rafraichir": "Refresh",
    "Chargement...": "Loading...",
    "Aucun fichier trouve.": "No file found.",
    "Aucun fichier selectionne": "No file selected",
    "Sauvegarde...": "Saving...",
    "Sauver": "Save",
    "Fichier binaire non affiche.": "Binary file not displayed.",
    "Fichier tronque pour l'affichage.": "File truncated for display.",
    "Selectionnez un fichier dans l'arborescence.":
      "Select a file in the tree.",
    "Terminal": "Terminal",
    "Demarrez une session pour ouvrir le terminal.":
      "Start a session to open the terminal.",
    "Tout": "All",
    "Clear": "Clear",
    "Aucun log pour le moment.": "No logs yet.",
    "Revenir à la vue précédente": "Back to previous view",
    "Revenir": "Back",
    "Paramètres utilisateur": "User settings",
    "Ces réglages sont stockés dans votre navigateur.":
      "These settings are stored in your browser.",
    "Afficher les commandes dans le chat": "Show commands in chat",
    "Affiche les blocs de commandes exécutées dans la conversation.":
      "Show executed command blocks in the conversation.",
    "Afficher les tool results dans le chat": "Show tool results in chat",
    "Affiche les blocs tool_result dans la conversation.":
      "Show tool_result blocks in the conversation.",
    "Chat pleine largeur": "Full width chat",
    "Utilise toute la largeur disponible pour la zone de chat.":
      "Use the full available width for the chat area.",
    "Notifications": "Notifications",
    "Affiche une notification et un son quand un nouveau message arrive.":
      "Show a notification and sound when a new message arrives.",
    "Mode sombre": "Dark mode",
    "Active le thème sombre pour l'interface.":
      "Enable the dark theme for the interface.",
    "Style de l'input": "Input style",
    "Choisissez un champ de saisie mono ou multiligne.":
      "Choose a single or multi-line input.",
    "Monoligne": "Single line",
    "Multiligne": "Multi-line",
    "Mode débug": "Debug mode",
    "Active l'accès aux logs et à l'export Markdown/JSON.":
      "Enable access to logs and Markdown/JSON export.",
    "Identité Git pour ce dépôt": "Git identity for this repository",
    "Renseignez user.name et user.email pour les commits du dépôt.":
      "Provide user.name and user.email for repository commits.",
    "Valeurs globales: {{name}} / {{email}}.":
      "Global values: {{name}} / {{email}}.",
    "Valeurs du dépôt: {{name}} / {{email}}.":
      "Repository values: {{name}} / {{email}}.",
    "Aucune valeur spécifique au dépôt.": "No repository-specific values.",
    "Nom complet": "Full name",
    "ton.email@exemple.com": "your.email@example.com",
    "Enregistrement...": "Saving...",
    "Enregistrer": "Save",
    "Pièces sélectionnées": "Selected attachments",
    "Ajouter une pièce jointe": "Add attachment",
    "Écris ton message…": "Write your message…",
    "Retirer {{label}}": "Remove {{label}}",
    "Stop": "Stop",
    "Aucune option.": "No options.",
    "Aucune option": "No options",
    "Continuer sur mobile": "Continue on mobile",
    "Scannez ce QR code dans l'application Android pour reprendre la session en cours.":
      "Scan this QR code in the Android app to resume the current session.",
    "Generation du QR code...": "Generating QR code...",
    "QR code indisponible.": "QR code unavailable.",
    "Expire dans {{seconds}}s": "Expires in {{seconds}}s",
    "QR code expire": "QR code expired",
    "Regenerer": "Regenerate",
    "Fermer le worktree ?": "Close the worktree?",
    "Toutes les modifications seront perdues. Que souhaitez-vous faire ?":
      "All changes will be lost. What would you like to do?",
    "Merge vers {{branch}}": "Merge into {{branch}}",
    "Supprimer le worktree": "Delete worktree",
    "Aperçu": "Preview",
    "Image jointe": "Attached image",
    "Messages": "Messages",
    "Diff": "Diff",
    "Logs": "Logs",
    "Exporter": "Export",
    "Effacer": "Clear",
    "Outils du chat": "Chat tools",
    "Paramètres": "Settings",
    "Reprendre sur mobile": "Resume on mobile",
    "Ouvrir les paramètres": "Open settings",
    "Quitter la session": "Leave session",
    "Fermer le panneau": "Close panel",
    "Backlog": "Backlog",
    "Aucune tâche": "No tasks",
    "{{count}} élément(s)": "{{count}} item(s)",
    "Aucune tâche en attente pour le moment.":
      "No pending tasks at the moment.",
    "Éditer": "Edit",
    "Lancer": "Launch",
    "Supprimer": "Delete",
    "{{count}} pièce(s) jointe(s)": "{{count}} attachment(s)",
    "Session": "Session",
    "Cloner une session": "Clone a session",
    "Workspace cree": "Workspace created",
    "Configurer les providers IA": "Configure AI providers",
    "Configurer le workspace": "Configure the workspace",
    "Selectionnez un workspace existant ou creez-en un nouveau.":
      "Select an existing workspace or create a new one.",
    "Rejoindre un workspace": "Join a workspace",
    "Accedez a un espace existant avec vos identifiants":
      "Access an existing space with your credentials",
    "Creer un workspace": "Create a workspace",
    "Creez un nouvel espace pour vous ou votre equipe":
      "Create a new space for you or your team",
    "Nom du workspace": "Workspace name",
    "Secret": "Secret",
    "workspaceId (ex: w...)": "workspaceId (e.g. w...)",
    "workspaceSecret": "workspaceSecret",
    "Validation...": "Validating...",
    "Continuer": "Continue",
    "Providers IA (obligatoire)": "AI providers (required)",
    "Auth {{provider}}": "Auth {{provider}}",
    "JSON credentials": "JSON credentials",
    "Cle ou token": "Key or token",
    "Retour": "Back",
    "Votre workspace a ete cree avec succes. Gardez ces identifiants scrupuleusement pour un futur acces.":
      "Your workspace has been created successfully. Keep these credentials carefully for future access.",
    "Workspace ID": "Workspace ID",
    "Copier le workspace ID": "Copy workspace ID",
    "Workspace Secret": "Workspace Secret",
    "Copier le workspace secret": "Copy workspace secret",
    "Nouvelle session": "New session",
    "Cloner un depot pour demarrer une nouvelle session":
      "Clone a repository to start a new session",
    "Reprendre une session existante": "Resume an existing session",
    "Reprendre un worktree deja configure":
      "Resume an already configured worktree",
    "Sessions existantes": "Existing sessions",
    "Chargement des sessions...": "Loading sessions...",
    "Aucune session disponible.": "No sessions available.",
    "Derniere activite: {{date}}": "Last activity: {{date}}",
    "Reprendre": "Resume",
    "Suppression...": "Deleting...",
    "Clonage du depot...": "Cloning repository...",
    "Nom de la session (optionnel)": "Session name (optional)",
    "Authentification depot (optionnelle)":
      "Repository authentication (optional)",
    "Aucune": "None",
    "Cle SSH privee": "Private SSH key",
    "Identifiant + mot de passe": "Username + password",
    "La cle est stockee dans ~/.ssh pour le clonage.":
      "The key is stored in ~/.ssh for cloning.",
    "Utilisateur": "Username",
    "Mot de passe ou PAT": "Password or PAT",
    "Le mot de passe peut etre remplace par un PAT.":
      "The password can be replaced by a PAT.",
    "Internet access": "Internet access",
    "Share git credentials": "Share git credentials",
    "Autoriser l'accès internet par defaut pour cette session.":
      "Allow default internet access for this session.",
    "Autoriser le partage du dossier Git pour la branche principale par defaut.":
      "Allow sharing the Git folder for the main branch by default.",
    "Providers IA": "AI providers",
    "Cloner": "Clone",
    "FILE": "FILE",
    "{{count}} o": "{{count}} B",
    "{{count}} Ko": "{{count}} KB",
    "{{count}} Mo": "{{count}} MB",
    "{{count}} lignes": "{{count}} lines",
    "Connexion...": "Connecting...",
    "Connecte": "Connected",
    "Deconnecte": "Disconnected",
    "Pret": "Ready",
    "Accès internet activé": "Internet access enabled",
    "Execution en cours": "Execution in progress",
    "Creation": "Creating",
    "En cours": "In progress",
    "Termine": "Completed",
    "Erreur inattendue": "Unexpected error",
    "Erreur: {{message}}": "Error: {{message}}",
    "Erreur": "Error",
    "Commande": "Command",
    "Commande: {{command}}": "Command: {{command}}",
    "Application de modifications...": "Applying changes...",
    "Outil: {{tool}}": "Tool: {{tool}}",
    "Raisonnement...": "Reasoning...",
    "Generation de reponse...": "Generating response...",
    "Codex": "Codex",
    "Claude": "Claude",
    "Codex (OpenAI)": "Codex (OpenAI)",
    "Basculement vers {{provider}}...": "Switching to {{provider}}...",
    "Identifiant et mot de passe requis.": "Username and password required.",
    "Token workspace invalide. Merci de vous reconnecter.":
      "Invalid workspace token. Please sign in again.",
    "Echec d'authentification Git{{suffix}}.": "Git authentication failed{{suffix}}.",
    "Depot Git introuvable{{suffix}}.": "Git repository not found{{suffix}}.",
    "Impossible de creer la session de pieces jointes (HTTP {{status}}{{statusText}}){{suffix}}.":
      "Unable to create the attachment session (HTTP {{status}}{{statusText}}){{suffix}}.",
    "Impossible de creer la session de pieces jointes.":
      "Unable to create the attachment session.",
    "Workspace ID et secret requis.": "Workspace ID and secret are required.",
    "Echec de l'authentification.": "Authentication failed.",
    "Echec de la configuration du workspace.": "Workspace configuration failed.",
    "Cle requise pour {{provider}}.": "Key required for {{provider}}.",
    "Selectionnez au moins un provider.": "Select at least one provider.",
    "Workspace ID requis.": "Workspace ID required.",
    "Echec de mise a jour du workspace.": "Workspace update failed.",
    "Providers IA mis a jour.": "AI providers updated.",
    "Echec de creation du workspace.": "Workspace creation failed.",
    "Session introuvable.": "Session not found.",
    "Supprimer la session \"{{title}}\" ? Cette action est irreversible.":
      "Delete session \"{{title}}\"? This action is irreversible.",
    "Impossible de supprimer la session{{suffix}}.":
      "Unable to delete the session{{suffix}}.",
    "Session \"{{title}}\" supprimee.": "Session \"{{title}}\" deleted.",
    "Impossible de supprimer la session.": "Unable to delete the session.",
    "Impossible de reprendre la session.": "Unable to resume the session.",
    "Impossible de changer de branche.": "Unable to change branch.",
    "Impossible d'uploader les pieces jointes.": "Unable to upload attachments.",
    "Impossible de charger l'explorateur.": "Unable to load the explorer.",
    "Impossible de charger le statut Git.": "Unable to load Git status.",
    "Impossible de charger le fichier.": "Unable to load the file.",
    "Impossible d'enregistrer le fichier.": "Unable to save the file.",
    "Tool": "Tool",
    "Tool result": "Tool result",
    "Historique du chat": "Chat history",
    "Onglet": "Tab",
    "Export": "Export",
    "Worktree": "Worktree",
    "Main": "Main",
    "Assistant": "Assistant",
    "Pièces jointes": "Attachments",
    "Stdin": "Stdin",
    "Stdout": "Stdout",
    "stdin": "stdin",
    "stdout": "stdout",
    "Markdown": "Markdown",
    "JSON": "JSON",
    "JSON-RPC": "JSON-RPC",
    "QR code": "QR code",
    "Quitter le workspace": "Leave workspace",
    "Configurez les providers IA pour ce workspace.":
      "Configure AI providers for this workspace.",
    "Non défini": "Not set",
    "Vous avez des modifications non sauvegardees. Continuer sans sauvegarder ?":
      "You have unsaved changes. Continue without saving?",
    "Envoyez un message pour demarrer une session.":
      "Send a message to start a session.",
    "Voir les messages precedents ({{count}})":
      "View previous messages ({{count}})",
    "api_key": "api_key",
    "auth_json_b64": "auth_json_b64",
    "setup_token": "setup_token",
    "user.name": "user.name",
    "user.email": "user.email",
    "git@gitea.devops:mon-org/mon-repo.git":
      "git@gitea.devops:my-org/my-repo.git",
    "-----BEGIN OPENSSH PRIVATE KEY-----": "-----BEGIN OPENSSH PRIVATE KEY-----",
    "Impossible de generer le QR code.": "Unable to generate the QR code.",
    "Token de reprise invalide.": "Invalid resume token.",
    "Erreur lors de la generation.": "Error during generation.",
    "Impossible de charger l'identité Git.": "Unable to load Git identity.",
    "Erreur lors du chargement.": "Error during loading.",
    "Nom et email requis.": "Name and email required.",
    "Echec de la mise à jour.": "Update failed.",
    "Identité Git du dépôt mise à jour.":
      "Repository Git identity updated.",
    "Impossible de charger les sessions.": "Unable to load sessions.",
    "Impossible de charger les branches.": "Unable to load branches.",
    "Impossible de charger le dernier commit.":
      "Unable to load the latest commit.",
    "Impossible de charger le commit.": "Unable to load the commit.",
    "Impossible de charger les modeles.": "Unable to load models.",
    "Nouveau message": "New message",
    "Limite d'usage atteinte. Merci de reessayer plus tard.":
      "Usage limit reached. Please try again later.",
    "Echec de l'authentification OpenAI.":
      "OpenAI authentication failed.",
    "Selectionner une branche": "Select a branch",
    "Nouvelle branche parallèle": "New parallel branch",
    "Nom (optionnel)": "Name (optional)",
    "ex: refactor-auth": "e.g. refactor-auth",
    "Branche source": "Source branch",
    "Selectionnez une branche distante valide.":
      "Select a valid remote branch.",
    "Provider": "Provider",
    "Modele": "Model",
    "Modele par defaut": "Default model",
    "Reasoning": "Reasoning",
    "Reasoning par defaut": "Default reasoning",
    "Selectionner une langue": "Select a language",
    "Langue": "Language",
    "Français": "French",
    "Anglais": "English",
    "Commit": "Commit",
    "Commit & Push": "Commit & Push",
    "Envoyer 'Commit' dans le chat": "Send 'Commit' in chat",
    "Envoyer 'Commit & Push' dans le chat": "Send 'Commit & Push' in chat",
    "{{count}} fichiers modifies": "{{count}} files modified",
    "Liste tronquee apres {{count}} entrees.":
      "List truncated after {{count}} entries.",
    "Messages": "Messages",
    "Diff": "Diff",
    "Explorateur": "Explorer",
    "Terminal": "Terminal",
    "Logs": "Logs",
  },
};

const getInitialLanguage = () => {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "fr" || stored === "en") {
      return stored;
    }
  } catch {
    // ignore
  }
  const nav = (navigator?.language || "").toLowerCase();
  return nav.startsWith("fr") ? "fr" : "en";
};

const interpolate = (template, vars) => {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    return match;
  });
};

const translate = (language, key, vars) => {
  if (language === "fr") {
    return interpolate(key, vars);
  }
  const map = translations[language] || {};
  const template = map[key] || key;
  return interpolate(template, vars);
};

const I18nContext = createContext({
  language: "fr",
  setLanguage: () => {},
  t: (key, vars) => translate("fr", key, vars),
  locale: "fr-FR",
});

export const I18nProvider = ({ children }) => {
  const [language, setLanguage] = useState(getInitialLanguage);

  useEffect(() => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // ignore
    }
  }, [language]);

  const locale = language === "fr" ? "fr-FR" : "en-US";

  const t = useCallback(
    (key, vars) => translate(language, key, vars),
    [language]
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      locale,
    }),
    [language, t, locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);
