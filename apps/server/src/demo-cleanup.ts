import type {Query,Scope} from './database.js';

const noLiveLeaseForScope=(alias:string)=>`NOT EXISTS (
  SELECT 1 FROM missions active_mission
  JOIN mission_execution_leases active_lease ON active_lease.mission_id=active_mission.id AND active_lease.expires_at>now()
  WHERE active_mission.owner_id=${alias}.owner_id AND active_mission.workspace_id=${alias}.workspace_id
)`;

export async function purgeDemoScope(q:Query,scope:Scope):Promise<void>{
  if(!scope.ownerId.startsWith('demo-user:'))return;
  // Keep a revoked scope's durable lease and supporting records until its
  // in-flight call has actually unwound. The deleted session prevents any new
  // work, while the lease continues to count against shared demo capacity.
  await q(`DELETE FROM temporary_context t WHERE t.owner_id=$1 AND t.workspace_id=$2 AND ${noLiveLeaseForScope('t')}`,[scope.ownerId,scope.workspaceId]);
  await q(`DELETE FROM upgrade_records u WHERE u.owner_id=$1 AND u.workspace_id=$2 AND ${noLiveLeaseForScope('u')}`,[scope.ownerId,scope.workspaceId]);
  await q(`DELETE FROM missions m WHERE m.owner_id=$1 AND m.workspace_id=$2 AND ${noLiveLeaseForScope('m')}`,[scope.ownerId,scope.workspaceId]);
}

/** Remove every server-side record belonging only to an expired anonymous scope. */
export async function purgeExpiredDemoData(q:Query):Promise<void>{
  await q(`DELETE FROM temporary_context t WHERE t.owner_id LIKE 'demo-user:%' AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.owner_id=t.owner_id AND s.workspace_id=t.workspace_id AND s.expires_at>now()) AND ${noLiveLeaseForScope('t')}`);
  await q(`DELETE FROM upgrade_records u WHERE u.owner_id LIKE 'demo-user:%' AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.owner_id=u.owner_id AND s.workspace_id=u.workspace_id AND s.expires_at>now()) AND ${noLiveLeaseForScope('u')}`);
  await q(`DELETE FROM missions m WHERE m.owner_id LIKE 'demo-user:%' AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.owner_id=m.owner_id AND s.workspace_id=m.workspace_id AND s.expires_at>now()) AND ${noLiveLeaseForScope('m')}`);
  await q('DELETE FROM sessions WHERE expires_at<=now()');
  await q("DELETE FROM public_demo_model_usage WHERE period_start<(now() AT TIME ZONE 'UTC')::date-7");
}

/** Disable public demo mode without leaving anonymous sessions runnable. */
export async function purgeAllDemoData(q:Query):Promise<void>{
  await q(`DELETE FROM temporary_context t WHERE t.owner_id LIKE 'demo-user:%' AND ${noLiveLeaseForScope('t')}`);
  await q(`DELETE FROM upgrade_records u WHERE u.owner_id LIKE 'demo-user:%' AND ${noLiveLeaseForScope('u')}`);
  await q(`DELETE FROM missions m WHERE m.owner_id LIKE 'demo-user:%' AND ${noLiveLeaseForScope('m')}`);
  // Disable every anonymous scope, while also applying ordinary token expiry to
  // private hosted sessions without touching their saved mission data.
  await q("DELETE FROM sessions WHERE owner_id LIKE 'demo-user:%' OR expires_at<=now()");
}

export async function maintainHostedDemoData(q:Query,publicDemoEnabled:boolean):Promise<void>{
  if(publicDemoEnabled)await purgeExpiredDemoData(q);
  else await purgeAllDemoData(q);
}
