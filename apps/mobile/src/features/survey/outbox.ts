import { registerOutboxHandler } from '../../core/outbox';
import { sendMeasurement, sendObservation, sendSiteAnswers } from './send';

export type { MeasurementPayload, ObservationPayload, SiteAnswersPayload } from './send';

// How each survey capture is sent lives in send.ts (node tests run it); registered here once.
registerOutboxHandler('survey.measurement', sendMeasurement);
registerOutboxHandler('survey.photo', sendObservation);
registerOutboxHandler('survey.answers', sendSiteAnswers);
