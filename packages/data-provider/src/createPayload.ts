import type * as t from './types';
import { EndpointURLs } from './config';
import * as s from './schemas';

/** Resolves the browser's IANA timezone so the server can localize prompt variables. */
function getUserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Resolves the browser's BCP-47 locale (e.g. `en-IN`) for region-aware tools (MCP). */
function getUserLocale(): string | undefined {
  try {
    return (typeof navigator !== 'undefined' && navigator.language) || undefined;
  } catch {
    return undefined;
  }
}

export default function createPayload(submission: t.TSubmission) {
  const {
    isEdited,
    addedConvo,
    userMessage,
    isContinued,
    isTemporary,
    isRegenerate,
    conversation,
    editedContent,
    ephemeralAgent,
    endpointOption,
    manualSkills,
  } = submission;
  const { conversationId } = s.tConvoUpdateSchema.parse(conversation);
  const { endpoint: _e, endpointType } = endpointOption as {
    endpoint: s.EModelEndpoint;
    endpointType?: s.EModelEndpoint;
  };

  const endpoint = _e as s.EModelEndpoint;
  let server = `${EndpointURLs[s.EModelEndpoint.agents]}/${endpoint}`;
  if (s.isAssistantsEndpoint(endpoint)) {
    server =
      EndpointURLs[(endpointType ?? endpoint) as 'assistants' | 'azureAssistants'] +
      (isEdited ? '/modify' : '');
  }

  const payload: t.TPayload = {
    ...userMessage,
    ...endpointOption,
    endpoint,
    addedConvo,
    isTemporary,
    isRegenerate,
    editedContent,
    conversationId,
    isContinued: !!(isEdited && isContinued),
    ephemeralAgent: s.isAssistantsEndpoint(endpoint) ? undefined : ephemeralAgent,
    manualSkills: s.isAssistantsEndpoint(endpoint) ? undefined : manualSkills,
    timezone: getUserTimezone(),
    locale: getUserLocale(),
  };

  return { server, payload };
}
