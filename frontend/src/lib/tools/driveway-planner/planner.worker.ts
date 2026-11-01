import { plan, type PlanInput } from './planner';

self.onmessage = (e: MessageEvent<PlanInput & { id: number }>) => {
	self.postMessage({ id: e.data.id, result: plan(e.data) });
};
