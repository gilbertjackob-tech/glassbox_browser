import { memory } from '../main/memoryDb.js';
import db from '../main/memoryDb.js';
import { v4 as uuidv4 } from 'uuid';
import { actionExecutor } from './actionExecutor.js';

export class MemoryService {
  async searchMemory(query: string, profileId: string = 'default') {
    return memory.search(query, profileId);
  }

  async searchSkills(query: string, profileId: string = 'default') {
    return db.prepare(`
      SELECT * FROM skills 
      WHERE profile_id = ? AND (name LIKE '%' || ? || '%' OR query_pattern LIKE '%' || ? || '%')
      ORDER BY success_count DESC, last_used DESC LIMIT 10
    `).all(profileId, query, query);
  }

  async runSkill(skillId: string, tabId: string, profileId: string) {
    const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as any;
    if (!skill) throw new Error('SKILL_NOT_FOUND');

    const actions = JSON.parse(skill.action_sequence);
    let successCount = 0;

    for (const action of actions) {
      try {
        const result = await actionExecutor.execute({
          ...action,
          tabId,
          profileId,
          intent: `Replaying skill: ${skill.name}`
        });
        if (result.success) successCount++;
        else break;
      } catch (e) {
        break;
      }
    }

    const overallSuccess = successCount === actions.length;
    
    db.prepare(`
      UPDATE skills SET 
        success_count = success_count + ?,
        failure_count = failure_count + ?,
        last_used = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(overallSuccess ? 1 : 0, overallSuccess ? 0 : 1, skillId);

    return { success: overallSuccess, stepsCompleted: successCount };
  }

  async createTask(profileId: string, query: string) {
    const id = uuidv4();
    db.prepare('INSERT INTO tasks (id, profile_id, query, status) VALUES (?, ?, ?, ?)')
      .run(id, profileId, query, 'running');
    return id;
  }

  async completeTask(taskId: string, success: boolean) {
    db.prepare('UPDATE tasks SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(success ? 'completed' : 'failed', taskId);

    // If success, automatically create a skill from it
    if (success) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
      const actions = db.prepare('SELECT * FROM actions WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as any[];
      
      if (actions.length > 0) {
        const skillId = uuidv4();
        const actionSequence = actions.map(a => ({
          actionType: a.type,
          target: { selector: a.target },
          input: a.value === '[MASKED]' ? undefined : a.value
        }));

        db.prepare(`
          INSERT INTO skills (id, profile_id, name, query_pattern, action_sequence)
          VALUES (?, ?, ?, ?, ?)
        `).run(skillId, task.profile_id, `Skill: ${task.query}`, task.query, JSON.stringify(actionSequence));
      }
    }
  }
}

export const memoryService = new MemoryService();
