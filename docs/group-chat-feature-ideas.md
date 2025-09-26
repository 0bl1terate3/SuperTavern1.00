# Group Chat Feature Concepts

This document captures potential enhancements for SuperTavern's multi-character chat experience. Each section summarizes the core idea, expected benefits, technical considerations, and open questions that should be resolved before implementation.

## 1. Reply Only When Mentioned (Per Character)
- **Overview:** Add a per-character toggle that suppresses automatic replies unless the character's name or alias appears in a recent message window.
- **Benefits:** Reduces dialog clutter and keeps side characters from interrupting scenes where they are not relevant.
- **Implementation Notes:**
  - Requires mention detection with configurable aliases.
  - Consider a grace condition so characters can respond after prolonged silence to avoid deadlocks.
  - UI should expose the toggle alongside existing talkativeness controls.
- **Risks & Questions:** How many turns should be inspected for mentions? What is the fallback cadence to prevent stagnation?

## 2. Selective Memory / Private Histories
- **Overview:** Maintain a private context for each character derived from their one-on-one conversations or curated memories in addition to the shared transcript.
- **Benefits:** Supports continuity, personal knowledge, and secrets that are not globally visible, enabling richer storytelling.
- **Implementation Notes:**
  - Requires updates to prompt assembly to merge public and private memories.
  - Memory storage could reuse the existing vector store with per-character namespaces.
  - Provide tooling to inspect or edit a character's private context for transparency.
- **Risks & Questions:** How do we resolve contradictions between private and public memories? How should private memories age or decay over time?

## 3. Quiet Unless Addressed with Silence Fallback
- **Overview:** Hybrid rule where characters remain silent unless mentioned, unless the scene has been idle for a configurable number of turns or seconds.
- **Benefits:** Combines conversational control with safeguards against stalemates.
- **Implementation Notes:**
  - Build on the mention detection foundation from Feature 1.
  - Need a scheduler or heuristic to pick the next speaker when the silence threshold is exceeded.
- **Risks & Questions:** What silence threshold feels natural? Should the fallback speaker be weighted by role priority?

## 4. Topic / Thread Splitting
- **Overview:** Allow sub-conversations in group chat so different character sets can converse in parallel threads.
- **Benefits:** Keeps large scenes organized and makes it easier to follow simultaneous interactions.
- **Implementation Notes:**
  - UI additions for creating, naming, and switching threads.
  - Prompt builder must include only the relevant thread context per response, with optional cross-thread references.
- **Risks & Questions:** How do we surface cross-thread events to prevent contradictory narratives? Can users merge or archive threads cleanly?

## 5. Role-Based Speaking Priorities
- **Overview:** Assign priority weights or roles (e.g., lead, supporting, cameo) that bias which characters respond first when multiple responses are possible.
- **Benefits:** Ensures main characters drive the scene while minor characters only interject when appropriate.
- **Implementation Notes:**
  - Integrate with existing talkativeness/timer logic.
  - Expose role configuration per chat or per scene.
- **Risks & Questions:** How dynamic should role adjustments be? Do priorities change automatically based on scene cues?

## 6. Ignore Context from Muted Characters
- **Overview:** When a character is muted, omit or aggressively compress their past messages before sending context to the model.
- **Benefits:** Prevents muted characters from influencing active participants and reduces prompt size.
- **Implementation Notes:**
  - Requires adjustments to the context assembler to filter or summarize muted content.
  - Provide safeguards so reactivating a character can optionally restore compressed context.
- **Risks & Questions:** Should we maintain a shadow history for muted characters in case the user unmutes them later?

## 7. Dynamic Talkativeness Modulation
- **Overview:** Replace static talkativeness levels with adaptive scores derived from sentiment, topical relevance, or silence duration.
- **Benefits:** Produces more lifelike conversations as characters wax and wane in engagement.
- **Implementation Notes:**
  - Define heuristics or ML signals that adjust talkativeness scores in real time.
  - Integrate with role priorities and mention detection for coherent behavior.
- **Risks & Questions:** How do we prevent oscillations or unpredictable swings? What telemetry should we expose to users?

## 8. Character Mood & State Influence
- **Overview:** Track emotional or situational states that impact reply likelihood, length, and style.
- **Benefits:** Adds depth and variability; characters can withdraw when upset or become verbose when excited.
- **Implementation Notes:**
  - Introduce a state model with transitions driven by user actions, memory triggers, or system heuristics.
  - Prompt templates should reference the current mood so the model adapts tone and verbosity.
- **Risks & Questions:** How persistent are moods? Do they survive chat resets or memory wipes?

## 9. Trigger Keywords & Commands
- **Overview:** Allow explicit commands (e.g., `/ask AI`, `@Guard`) that force specific characters or system actors to respond.
- **Benefits:** Gives users precise control over the narrative and supports system/narrator roles.
- **Implementation Notes:**
  - Implement lightweight command parsing before messages reach the model.
  - Provide validation and feedback when commands are malformed or unknown.
- **Risks & Questions:** How do we avoid collisions with natural language? Should commands be configurable per chat?

## 10. Delayed Responses / Thinking Pauses
- **Overview:** Simulate hesitation by delaying replies or inserting textual pauses ("...", "(pauses)").
- **Benefits:** Improves pacing and perceived realism.
- **Implementation Notes:**
  - Requires UI support for staged message delivery or spinner animations.
  - The response pipeline must accommodate asynchronous reveals without blocking other activity.
- **Risks & Questions:** How do delays interact with real-time collaborations or voice playback features?

## 11. Speech Styles & Formatting
- **Overview:** Define per-character stylistic rules (e.g., brevity, slang, stutters, emoji usage).
- **Benefits:** Strengthens character differentiation and roleplaying flavor.
- **Implementation Notes:**
  - Store style preferences alongside character metadata.
  - Inject style guidance into prompts, potentially via system messages or instruction prefixes.
- **Risks & Questions:** How do we prevent prompt bloat? Should users be able to toggle styles mid-scene?

## 12. Recall / Memory Queries
- **Overview:** Let users ask a character to recall private or shared memories without retyping them.
- **Benefits:** Facilitates continuity and recap moments.
- **Implementation Notes:**
  - Expose a UI action or slash command that retrieves relevant memory chunks and surfaces them in chat.
  - Requires the private memory infrastructure from Feature 2.
- **Risks & Questions:** How do we handle sensitive memories or spoilers? Should recalls appear as separate narrative messages?

## 13. Adaptive Message Fade-Out
- **Overview:** Summarize or archive older messages (globally or per character) as the conversation grows.
- **Benefits:** Controls context length and keeps prompts performant.
- **Implementation Notes:**
  - Hook into the existing summarization pipeline (if available) or build a new summarizer triggered by context size thresholds.
  - Provide UI to view archived summaries and optionally restore details.
- **Risks & Questions:** How do we guarantee summary fidelity? What triggers a re-expansion of archived segments?

## 14. Character Spotlight Mode
- **Overview:** Temporarily focus on a subset of characters, lowering others' reply priority or hiding them from view.
- **Benefits:** Supports scene changes and intimate interactions within larger parties.
- **Implementation Notes:**
  - Integrate with talkativeness and role priority logic.
  - UI needs controls to enter/exit spotlight mode and select participants.
- **Risks & Questions:** When spotlight ends, do sidelined characters catch up via summaries? How is spotlight state represented in saves?

## 15. Auto Scene Transitions & Ambient Narration
- **Overview:** Automatically insert environmental descriptions when the scene changes based on user cues or silence intervals.
- **Benefits:** Maintains immersion and reduces narration burden on the user.
- **Implementation Notes:**
  - Detect scene shifts via keywords, structured commands, or manual triggers.
  - Provide a library of ambient templates and allow customization per world.
- **Risks & Questions:** How do we avoid overriding user narrative control? Should ambient inserts count against token budgets?

---

### Prioritization Suggestions
1. **Mention-based reply controls (Features 1 & 3)** — Builds foundational infrastructure for mention detection and silence handling that other features can reuse.
2. **Selective memory & recall tooling (Features 2 & 12)** — Leverages existing requests and enables deeper roleplay.
3. **Context hygiene improvements (Features 6 & 13)** — Directly improves performance and relevance.
4. **Expressiveness enhancers (Features 7, 8, 11)** — Adds flavor once core behavior is stable.
5. **Advanced orchestration (Features 4, 5, 14, 15)** — Higher complexity; consider after foundational systems mature.

Each initiative should include discovery spikes to validate UX implications, prompt cost, and moderation impacts before full implementation.
