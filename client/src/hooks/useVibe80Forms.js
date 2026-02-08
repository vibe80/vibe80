import { useCallback, useEffect, useState } from "react";

export default function useVibe80Forms({
  t,
  choicesKey,
  input,
  setInput,
  handleSendMessageRef,
  draftAttachments,
  setDraftAttachments,
}) {
  const [choiceSelections, setChoiceSelections] = useState({});
  const [activeForm, setActiveForm] = useState(null);
  const [activeFormValues, setActiveFormValues] = useState({});

  useEffect(() => {
    if (!choicesKey) {
      setChoiceSelections({});
      return;
    }
    try {
      const stored = JSON.parse(localStorage.getItem(choicesKey) || "{}");
      setChoiceSelections(
        stored && typeof stored === "object" && !Array.isArray(stored)
          ? stored
          : {}
      );
    } catch (error) {
      setChoiceSelections({});
    }
  }, [choicesKey]);

  useEffect(() => {
    if (!choicesKey) {
      return;
    }
    localStorage.setItem(choicesKey, JSON.stringify(choiceSelections));
  }, [choiceSelections, choicesKey]);

  const openVibe80Form = useCallback((block, blockKey) => {
    if (!block?.fields?.length) {
      return;
    }
    const defaults = {};
    block.fields.forEach((field) => {
      if (field.type === "checkbox") {
        defaults[field.id] = Boolean(field.defaultChecked);
      } else if (field.type === "radio" || field.type === "select") {
        defaults[field.id] = field.choices?.[0] || "";
      } else {
        defaults[field.id] = field.defaultValue || "";
      }
    });
    setActiveForm({ ...block, key: blockKey });
    setActiveFormValues(defaults);
  }, []);

  const closeVibe80Form = useCallback(() => {
    setActiveForm(null);
    setActiveFormValues({});
  }, []);

  const updateActiveFormValue = useCallback((fieldId, value) => {
    setActiveFormValues((current) => ({
      ...current,
      [fieldId]: value,
    }));
  }, []);

  const sendFormMessage = useCallback(
    (text) => {
      const preservedInput = input;
      const preservedAttachments = draftAttachments;
      handleSendMessageRef.current?.(text, []);
      setInput(preservedInput);
      setDraftAttachments(preservedAttachments);
    },
    [draftAttachments, handleSendMessageRef, input, setDraftAttachments, setInput]
  );

  const submitActiveForm = useCallback(
    (event) => {
      event?.preventDefault();
      if (!activeForm) {
        return;
      }
      const lines = activeForm.fields.map((field) => {
        let value = activeFormValues[field.id];
        if (field.type === "checkbox") {
          value = value ? "1" : "0";
        }
        if (value === undefined || value === null) {
          value = "";
        }
        return `${field.id}=${value}`;
      });
      sendFormMessage(lines.join("\n"));
      closeVibe80Form();
    },
    [activeForm, activeFormValues, closeVibe80Form, sendFormMessage]
  );

  const handleChoiceClick = useCallback(
    (choice, blockKey, choiceIndex) => {
      setChoiceSelections((prev) => ({
        ...prev,
        [blockKey]: choiceIndex,
      }));
      setInput(choice);
      handleSendMessageRef.current?.(choice);
    },
    [handleSendMessageRef, setInput]
  );

  return {
    choiceSelections,
    setChoiceSelections,
    activeForm,
    activeFormValues,
    openVibe80Form,
    closeVibe80Form,
    updateActiveFormValue,
    submitActiveForm,
    handleChoiceClick,
    setActiveForm,
    setActiveFormValues,
  };
}
