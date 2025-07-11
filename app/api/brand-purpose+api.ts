import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { getBrandContextForAI, enhanceSystemPromptWithBrandContext } from "@/lib/ai-brand-context";

const BRAND_PURPOSE_SYSTEM_PROMPT = `
ROLE:
You are a thoughtful, strategic brand guide. Your job is to help the user uncover their brand's purpose — without asking "what's your brand purpose?" directly. Instead, guide them step-by-step through reflective prompts. Always ask only one question at a time, wait for the user's full response, then decide the next best move based on what's missing or vague.

GOAL:
Arrive at a clear, emotionally resonant Brand Purpose Statement that communicates:
- Why the brand exists
- Who it serves
- What it stands for
- How it positively changes the world (even in a small way)

STEP 1: OPENING QUESTION
Ask: "Imagine your brand disappeared tomorrow. What would your customers miss most — and why would that matter?"

Then:
- Wait for the user's response.
- Score the response across these 4 dimensions:
  * Audience (who it serves): 0–2
  * Benefit (how it helps): 0–2
  * Belief (what it stands for): 0–2
  * Impact (why it matters): 0–2

Total possible score: 8.
If total < 6 or any category scores 0, move to STEP 2 and ask the appropriate follow-up.
Otherwise, go to STEP 3.

STEP 2: FOLLOW-UP QUESTION LOGIC
Choose a follow-up based on what's missing:

If this is missing...	Ask this follow-up
- Audience (score 0): "Who exactly would feel that loss most? Who is this really for?"
- Benefit (score 0): "What does your brand help them do, feel, or become?"
- Belief (score 0): "What does that say about what your brand stands for or believes in?"
- Impact (score 0): "How are their lives different because your brand exists?"
- Multiple areas weak: "Can you describe a time your brand truly made a difference for someone?"

→ After user responds, update your scores. If any dimension is still weak, continue asking the appropriate follow-up from the list above until all areas are covered clearly.

STEP 3: SYNTHESIZE DRAFT PURPOSE STATEMENT
Once all 4 areas are present and clear (score ≥ 1 each), say:

"Thanks — based on everything you've shared, here's a first draft of your brand purpose statement. Let me know how it feels to you."

Format the statement like this:
"We exist to [transform/help/support] [audience] by [what you do/offer], because we believe [value/belief]."

Example:
"We exist to help busy new moms feel in control of their lives again by offering beautifully designed, time-saving home tools — because we believe confidence starts at home."

STEP 4: VALIDATION AND REFINEMENT
Ask: "Does this feel true to your brand?"

If user says:
- Yes: Offer to polish tone or style.
- Not sure / No: Ask: "Which part doesn't feel quite right — the who, the what, the why, or the belief?"

Then dig deeper using custom clarification questions.
Update the statement and loop back until the user says it feels aligned.

Optional:
Once confirmed, offer: "Would you like to save this, refine it into shorter taglines, or explore how to bring this purpose to life across your brand?"

Always maintain a warm, encouraging tone and celebrate progress. Keep responses conversational and supportive.
`;

// Security constants
const MAX_REQUESTS_PER_MINUTE = 10;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_MESSAGES_COUNT = 50;

export async function POST(req: Request) {
	try {
		// ✅ ENHANCED: Check OpenAI API key availability
		if (!process.env.OPENAI_API_KEY) {
			console.error('❌ OPENAI_API_KEY not found in environment variables');
			return new Response(JSON.stringify({
				error: 'API configuration error',
				message: 'OpenAI API key not configured. Please check your environment setup.',
				code: 'MISSING_API_KEY'
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const { messages, userId } = await req.json();

		// ✅ ENHANCED: Better input validation with detailed errors
		if (!messages || !Array.isArray(messages)) {
			return new Response(JSON.stringify({
				error: 'Invalid request format',
				message: 'Messages must be provided as an array',
				code: 'INVALID_MESSAGES_FORMAT'
			}), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		if (messages.length > MAX_MESSAGES_COUNT) {
			return new Response(JSON.stringify({
				error: 'Too many messages',
				message: `Maximum ${MAX_MESSAGES_COUNT} messages allowed per conversation`,
				code: 'MESSAGE_LIMIT_EXCEEDED'
			}), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// ✅ Make userId optional - generate anonymous ID if needed
		let sessionUserId = userId;
		if (!sessionUserId || typeof sessionUserId !== "string") {
			sessionUserId = `anonymous_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		}

		// Sanitize inputs
		const sanitizedMessages = messages
			.map((msg) => ({
				...msg,
				content:
					typeof msg.content === "string"
						? msg.content.slice(0, MAX_MESSAGE_LENGTH).trim()
						: "",
				role:
					msg.role === "user" || msg.role === "assistant" ? msg.role : "user",
			}))
			.filter((msg) => msg.content.length > 0);

		if (sanitizedMessages.length === 0) {
			return new Response(JSON.stringify({
				error: 'No valid messages',
				message: 'At least one valid message is required',
				code: 'NO_VALID_MESSAGES'
			}), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Get brand context for AI personalization
		const brandContext = sessionUserId && !sessionUserId.startsWith('anonymous_')
			? await getBrandContextForAI(sessionUserId)
			: '';

		// Enhance system prompt with brand context
		const enhancedSystemPrompt = enhanceSystemPromptWithBrandContext(
			BRAND_PURPOSE_SYSTEM_PROMPT,
			brandContext
		);

		const messagesWithSystem = [
			{ role: "system", content: enhancedSystemPrompt },
			...sanitizedMessages,
		];

		// ✅ ENHANCED: Better error handling for OpenAI calls
		try {
			const result = streamText({
				model: openai("gpt-4o"),
				messages: messagesWithSystem,
				maxTokens: 800,
				temperature: 0.7,
			});

			return result.toDataStreamResponse({
				headers: {
					"Content-Type": "application/octet-stream",
					"Content-Encoding": "none",
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type, Authorization",
				},
			});
		} catch (openaiError) {
			console.error("OpenAI API error:", openaiError);
			return new Response(JSON.stringify({
				error: 'AI service error',
				message: 'Failed to process AI request. Please try again.',
				code: 'OPENAI_ERROR',
				details: openaiError instanceof Error ? openaiError.message : 'Unknown error'
			}), {
				status: 503,
				headers: { 'Content-Type': 'application/json' }
			});
		}

	} catch (error) {
		console.error("Brand purpose API error:", error);
		return new Response(JSON.stringify({
			error: 'Internal server error',
			message: 'An unexpected error occurred. Please try again.',
			code: 'INTERNAL_ERROR'
		}), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}
