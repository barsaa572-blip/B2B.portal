import { HttpError } from './request-security.mjs';
// Only raise BEFORE a supplier booking mutation. Never after bookOrder timeout.
export class BookingReviewRequired extends HttpError {
  constructor(message) { super(409, message); }
}
