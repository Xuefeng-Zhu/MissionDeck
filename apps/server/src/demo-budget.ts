import type {Query} from './database.js';
import {HttpError} from './errors.js';

/** Atomically reserve one provider call before it can leave the hosted demo. */
export async function consumePublicDemoModelCall(q:Query,dailyLimit:number):Promise<number> {
  const usage=await q<{model_calls:number}>(`INSERT INTO public_demo_model_usage(period_start,model_calls,updated_at) VALUES((now() AT TIME ZONE 'UTC')::date,1,now())
    ON CONFLICT(period_start) DO UPDATE SET model_calls=public_demo_model_usage.model_calls+1,updated_at=now()
    WHERE public_demo_model_usage.model_calls<$1 RETURNING model_calls`,[dailyLimit]);
  if(!usage.rows.length)throw new HttpError(429,'The shared demo has reached its daily model budget. Try again after the UTC reset.','demo_budget');
  return usage.rows[0]!.model_calls;
}
