import { tabManager } from './tabManager.js';
import db from '../main/memoryDb.js';
import { v4 as uuidv4 } from 'uuid';
import CryptoJS from 'crypto-js';
import { normalizeUrl } from '../lib/urlUtils.js';

export interface ActionContract {
  intent: string;
  tabId: string;
  profileId: string;
  taskId?: string; // Added for task linking
  actionType: 'click' | 'type' | 'navigate' | 'scroll' | 'wait_for' | 'agent';
  target?: {
    selector?: string;
    text?: string;
    role?: string;
    id?: string;
    type?: string; // Added to check for password type
  };
  input?: string;
}

export class ActionExecutor {
  async execute(contract: ActionContract) {
    const tab = tabManager.getTab(contract.tabId);
    if (!tab) throw new Error('TAB_NOT_FOUND');

    const wc = tab.view.webContents;
    const beforeUrl = wc.getURL();
    const beforeDomHash = tab.domHash;

    let success = false;
    let reason = '';
    let evidence = { url_changed: false, dom_changed: false, action_executed: false };

    try {
      switch (contract.actionType) {
        case 'navigate':
          if (!contract.input) throw new Error('INVALID_INPUT:URL_REQUIRED');
          const finalUrl = normalizeUrl(contract.input);
          await wc.loadURL(finalUrl);
          success = true;
          break;

        case 'agent':
          // Mock handling for agent tasks for now
          // A task like "search for flights" could be dispatched to an LLM loop here
          success = true;
          reason = 'Agent tasks not yet fully orchestrated. Command captured.';
          break;

        case 'click':
          const selector = this.resolveSelector(contract.target);
          const safeSelector = selector.replace(/"/g, '\\"');
          const clicked = await wc.executeJavaScript(`
            (function() {
              const el = document.querySelector("${safeSelector}");
              if (el) { 
                el.click(); 
                return true; 
              }
              return false;
            })()
          `);
          if (!clicked) throw new Error('ELEMENT_NOT_FOUND');
          success = true;
          break;

        case 'type':
          const tSelector = this.resolveSelector(contract.target);
          const safeTSelector = tSelector.replace(/"/g, '\\"');
          if (contract.input === undefined) throw new Error('INVALID_INPUT:TEXT_REQUIRED');
          
          const focused = await wc.executeJavaScript(`
            (function() {
              const el = document.querySelector("${safeTSelector}");
              if (el) { 
                el.focus();
                return true; 
              }
              return false;
            })()
          `);
          
          if (!focused) throw new Error('ELEMENT_NOT_FOUND');
          
          // Use native Electron text insertion
          wc.insertText(contract.input);
          success = true;
          break;

        case 'wait_for':
          await new Promise(r => setTimeout(r, 2000));
          success = true;
          break;
      }

      // Verification Sleep
      await new Promise(r => setTimeout(r, 1000));
      
      const afterUrl = wc.getURL();
      const afterDomHash = tab.domHash; 

      evidence.url_changed = (beforeUrl !== afterUrl);
      evidence.dom_changed = (beforeDomHash !== afterDomHash);
      evidence.action_executed = success;

      if (success) {
        // For navigation, URL change is sufficient verification
        if (contract.actionType === 'navigate') {
          if (evidence.url_changed) {
            reason = 'VERIFIED: Navigation successful (URL changed)';
          } else {
            // Still mark as successful if the navigate was executed (URL may not change if already on same URL)
            reason = 'COMPLETED: Navigation executed';
          }
        } else {
          // For other actions, require state change
          if (evidence.url_changed || evidence.dom_changed) {
            reason = 'VERIFIED: State change detected';
          } else {
            reason = 'COMPLETED: No state shift detected';
            success = false; // Fail if no change as per strict requirement for non-navigate actions
          }
        }
      }

    } catch (e: any) {
      success = false;
      reason = e.message;
    }

    // Mask password
    let logValue = contract.input || null;
    if (contract.actionType === 'type' && contract.target?.type === 'password') {
      logValue = '[MASKED]';
    }

    // Final Log Entry
    try {
      db.prepare(`
        INSERT INTO actions (
          id, task_id, tab_id, profile_id, type, 
          target, value, success, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(),
        contract.taskId || null,
        contract.tabId,
        contract.profileId,
        contract.actionType,
        this.resolveSelector(contract.target),
        logValue,
        success ? 1 : 0,
        reason
      );
    } catch (err) {
      console.warn('Failed to log action to DB', err);
    }

    return { success, reason, evidence };
  }

  private resolveSelector(target?: any) {
    if (target?.id) return `#${target.id}`;
    if (target?.selector) return target.selector;
    if (target?.text) return `[aria-label*="${target.text}"], button:contains("${target.text}"), a:contains("${target.text}")`;
    return 'body';
  }
}

export const actionExecutor = new ActionExecutor();
