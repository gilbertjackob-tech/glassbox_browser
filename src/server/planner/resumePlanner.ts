/**
 * Resume Planner
 *
 * Core logic for stateful task planning:
 * - Parse a natural goal or structured task
 * - Scan current world state
 * - Determine what's already done
 * - Return conditional next steps
 *
 * This turns: "Send file to Bihi"
 * Into: "Skip: already in Bihi chat. Skip: file attached. Next: press send."
 */

import type { WorldState } from './worldStateService';

export interface ResumeStep {
  id: string;
  goal: string;
  preconditions: string[];
  alreadyDoneCheck: string[];
  action: string;
  actionParams?: Record<string, any>;
  verify: string[];
  skipIfSatisfied: boolean;
  failureRecovery?: string[];
}

export interface TaskResumePlan {
  goal: string;
  taskId: string;
  status:
    | 'ALREADY_DONE'
    | 'READY_TO_START'
    | 'READY_TO_RESUME'
    | 'BLOCKED_AUTH_REQUIRED'
    | 'BLOCKED_APP_NOT_RUNNING'
    | 'BLOCKED_UNKNOWN';
  blockedReason?: string;
  worldState: WorldState;
  skippedSteps: Array<{ stepId: string; reason: string }>;
  nextSteps: ResumeStep[];
  completionEvidenceKeys?: string[];
  suggestedTab?: string;
  confidence: number;
}

/**
 * Common task templates for resume logic
 */
export const commonTasks = {
  whatsapp_send_file: {
    steps: [
      {
        id: 'ensure_app_running',
        goal: 'Ensure GlassBox app is running',
        preconditions: [],
        alreadyDoneCheck: ['appRunning == true'],
        action: 'launch_glassbox',
        skipIfSatisfied: true,
        verify: ['appRunning'],
      },
      {
        id: 'ensure_profile_active',
        goal: 'Ensure correct profile is active',
        preconditions: ['appRunning'],
        alreadyDoneCheck: ['activeProfileId == {profileId}'],
        action: 'open_profile',
        actionParams: { profileId: '{profileId}' },
        skipIfSatisfied: true,
        verify: ['activeProfileId == {profileId}'],
      },
      {
        id: 'ensure_whatsapp_tab',
        goal: 'Ensure WhatsApp tab exists and is ready',
        preconditions: ['activeProfileId'],
        alreadyDoneCheck: [
          'tabs.any(t => t.host.includes("whatsapp") && t.readyState == "complete")',
        ],
        action: 'open_or_focus_whatsapp',
        skipIfSatisfied: true,
        verify: [
          'focusedTab.host.includes("whatsapp")',
          'focusedTab.readyState == "complete"',
        ],
      },
      {
        id: 'ensure_target_chat_open',
        goal: 'Ensure target chat is open',
        preconditions: ['whatsapp_tab_ready'],
        alreadyDoneCheck: [
          'focusedTab.room == "whatsapp_chat"',
          'visibleTargets.any(t => t.label.includes("{chatName}"))',
        ],
        action: 'whatsapp_open_chat',
        actionParams: { chat: '{chatName}' },
        skipIfSatisfied: true,
        verify: ['visibleTargets.any(t => t.label.includes("{chatName}"))'],
      },
      {
        id: 'attach_file',
        goal: 'Attach file to chat',
        preconditions: ['target_chat_open'],
        alreadyDoneCheck: [
          'visibleTargets.any(t => t.label.includes("preview") && t.visible)',
        ],
        action: 'whatsapp_attach_file',
        actionParams: { filePath: '{filePath}' },
        skipIfSatisfied: true,
        verify: ['visibleTargets.any(t => t.label.includes("preview"))'],
      },
      {
        id: 'send_file',
        goal: 'Send file',
        preconditions: ['file_attached'],
        alreadyDoneCheck: [],
        action: 'whatsapp_send_file',
        actionParams: { caption: '{caption}' },
        skipIfSatisfied: false,
        verify: ['lastVerifiedAction.action == "whatsapp_send_file"'],
      },
    ] as ResumeStep[],
  },

  chatgpt_send_prompt: {
    steps: [
      {
        id: 'ensure_chatgpt_tab',
        goal: 'Ensure ChatGPT is open and ready',
        preconditions: [],
        alreadyDoneCheck: ['focusedTab.room == "chatgpt_chat"'],
        action: 'open_chatgpt_or_focus',
        skipIfSatisfied: true,
        verify: ['focusedTab.room == "chatgpt_chat"'],
      },
      {
        id: 'ensure_composer_visible',
        goal: 'Ensure composer is visible and ready',
        preconditions: ['chatgpt_tab_ready'],
        alreadyDoneCheck: [
          'visibleTargets.any(t => t.key.includes("composer"))',
        ],
        action: 'focus_chatgpt_composer',
        skipIfSatisfied: true,
        verify: ['visibleTargets.any(t => t.key.includes("composer"))'],
      },
      {
        id: 'type_prompt',
        goal: 'Type prompt into composer',
        preconditions: ['composer_ready'],
        alreadyDoneCheck: [],
        action: 'type_in_composer',
        actionParams: { text: '{prompt}' },
        skipIfSatisfied: false,
        verify: ['visibleTargets.any(t => t.label.includes("{prompt}"))'],
      },
      {
        id: 'send_prompt',
        goal: 'Send prompt',
        preconditions: ['prompt_typed'],
        alreadyDoneCheck: [],
        action: 'press_send_in_chatgpt',
        skipIfSatisfied: false,
        verify: ['focusedTab.title.includes("ChatGPT")'],
      },
    ] as ResumeStep[],
  },
};

export async function planTaskResume(
  goal: string,
  worldState: WorldState,
  taskTemplate?: ResumeStep[]
): Promise<TaskResumePlan> {
  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const plan: TaskResumePlan = {
    goal,
    taskId,
    status: 'READY_TO_START',
    worldState,
    skippedSteps: [],
    nextSteps: [],
    confidence: 0.5,
  };

  // Check basic blockers
  if (!worldState.appRunning) {
    plan.status = 'BLOCKED_APP_NOT_RUNNING';
    plan.blockedReason = 'GlassBox is not running';
    return plan;
  }

  // If auth is required on focused tab, block
  if (worldState.focusedTabId) {
    const focusedTab = worldState.tabs.find((t) => t.tabId === worldState.focusedTabId);
    if (focusedTab?.diagnostics?.isAuthPage) {
      plan.status = 'BLOCKED_AUTH_REQUIRED';
      plan.blockedReason = `Authentication required on ${focusedTab.host}`;
      return plan;
    }
  }

  // Use template if provided, otherwise try to infer
  const steps = taskTemplate || inferStepsFromGoal(goal);

  if (!steps || steps.length === 0) {
    plan.status = 'READY_TO_START';
    plan.nextSteps = [];
    return plan;
  }

  // Evaluate each step
  const satisfiedChecks = new Map<string, boolean>();

  for (const step of steps) {
    // Check preconditions
    const preconditionsMet = step.preconditions.every(
      (pc) => satisfiedChecks.get(pc) !== false
    );

    if (!preconditionsMet) {
      plan.skippedSteps.push({
        stepId: step.id,
        reason: `Precondition not met: ${step.preconditions.join(', ')}`,
      });
      continue;
    }

    // Check if already done
    let alreadyDone = false;
    for (const check of step.alreadyDoneCheck) {
      if (evaluateCondition(check, worldState)) {
        alreadyDone = true;
        break;
      }
    }

    if (alreadyDone && step.skipIfSatisfied) {
      plan.skippedSteps.push({
        stepId: step.id,
        reason: `Already done: ${step.alreadyDoneCheck.join(' OR ')}`,
      });
      satisfiedChecks.set(step.id, true);
      continue;
    }

    // This step needs to be executed
    plan.nextSteps.push(step);
    satisfiedChecks.set(step.id, false); // Mark as not yet done
  }

  // Determine overall status
  if (plan.nextSteps.length === 0) {
    plan.status = 'ALREADY_DONE';
    plan.confidence = 0.95;
  } else {
    plan.status = 'READY_TO_RESUME';
    plan.confidence = Math.max(0.6, 1.0 - plan.nextSteps.length * 0.1);
  }

  return plan;
}

function inferStepsFromGoal(goal: string): ResumeStep[] {
  const lower = goal.toLowerCase();

  if (
    lower.includes('whatsapp') &&
    (lower.includes('send') || lower.includes('file'))
  ) {
    return commonTasks.whatsapp_send_file.steps;
  }

  if (
    lower.includes('chatgpt') &&
    (lower.includes('prompt') || lower.includes('ask'))
  ) {
    return commonTasks.chatgpt_send_prompt.steps;
  }

  return [];
}

function evaluateCondition(condition: string, worldState: WorldState): boolean {
  // Simple evaluation of common checks
  // This is a stub; a real implementation would need a proper expression evaluator

  if (condition === 'appRunning == true') return worldState.appRunning;
  if (condition === 'appRunning == false') return !worldState.appRunning;

  if (condition.includes('activeProfileId')) {
    const [, profileId] = condition.split('==');
    return worldState.activeProfileId === profileId?.trim();
  }

  if (condition.includes('focusedTab.host.includes')) {
    const match = condition.match(/includes\("([^"]+)"\)/);
    if (!match) return false;
    const focused = worldState.tabs.find((t) => t.tabId === worldState.focusedTabId);
    return focused?.host.includes(match[1]) ?? false;
  }

  if (condition.includes('focusedTab.room')) {
    const match = condition.match(/room == "([^"]+)"/);
    if (!match) return false;
    const focused = worldState.tabs.find((t) => t.tabId === worldState.focusedTabId);
    return focused?.room === match[1];
  }

  if (condition.includes('visibleTargets.any')) {
    const match = condition.match(/includes\("([^"]+)"\)/);
    if (!match) return false;
    return worldState.visibleTargets.some((t) => t.label.includes(match[1]));
  }

  return false;
}

export function describePlan(plan: TaskResumePlan): string {
  const parts: string[] = [];

  parts.push(`📋 Task: ${plan.goal}`);
  parts.push(`Status: ${plan.status}`);

  if (plan.blockedReason) {
    parts.push(`🚫 Blocked: ${plan.blockedReason}`);
  }

  if (plan.skippedSteps.length > 0) {
    parts.push(`\n⏭️  Skipped ${plan.skippedSteps.length} steps:`);
    for (const skip of plan.skippedSteps) {
      parts.push(`  • ${skip.stepId}: ${skip.reason}`);
    }
  }

  if (plan.nextSteps.length > 0) {
    parts.push(`\n▶️  Next ${plan.nextSteps.length} steps:`);
    for (const step of plan.nextSteps) {
      parts.push(`  • ${step.id}: ${step.goal}`);
    }
  }

  parts.push(`\nConfidence: ${(plan.confidence * 100).toFixed(0)}%`);

  return parts.join('\n');
}
