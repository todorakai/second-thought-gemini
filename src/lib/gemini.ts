// Gemini AI Client
import { GoogleGenAI } from "@google/genai";
import { calculateOpportunityCost } from './opportunity-cost';
import type { ProductInfo, AnalysisResult, UserProfile, PricingWarning } from './types';

const MODEL = 'gemini-3-flash-preview';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Initialize Gemini client
const ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
});

// Fallback response when AI is unavailable
const FALLBACK_ANALYSIS: AnalysisResult = {
    isEssential: false,
    essentialityScore: 0.5,
    reasoning: "We couldn't analyze this purchase right now. Consider waiting 24 hours before deciding.",
    warnings: [],
    opportunityCost: {
        amount: 0,
        projections: { years5: 0, years10: 0, years20: 0 },
        comparisonText: '',
    },
    personalizedMessage: 'Take a moment to reflect on whether you truly need this item.',
    suggestedAction: 'cooldown',
};

function buildPrompt(product: ProductInfo, userProfile?: UserProfile): string {
    const goalsSection = userProfile?.financialGoals?.length
        ? `\nUser's Financial Goals: ${userProfile.financialGoals.join(', ')}`
        : '';

    const budgetSection = userProfile?.monthlyBudget
        ? `\nMonthly Budget: ${userProfile.monthlyBudget}`
        : '';

    const savingsSection = userProfile?.savingsGoal
        ? `\nSavings Goal: ${userProfile.savingsGoal}`
        : '';

    return `You are a financial wellness assistant helping users make better purchasing decisions.

Analyze this potential purchase and provide guidance:

Product: ${product.name}
Price: ${product.currency} ${product.price}
${product.originalPrice ? `Original Price: ${product.currency} ${product.originalPrice}` : ''}
${product.category ? `Category: ${product.category}` : ''}
${product.urgencyIndicators?.length ? `Urgency Indicators Found: ${product.urgencyIndicators.join(', ')}` : ''}
${goalsSection}${budgetSection}${savingsSection}

Respond in JSON format with these fields:
{
  "isEssential": boolean (true if this is a necessary purchase like food, medicine, utilities),
  "essentialityScore": number (0-1, how essential is this purchase),
  "reasoning": string (brief explanation of your assessment),
  "warnings": [
    {
      "type": "fake_discount" | "urgency_manipulation" | "inflated_price",
      "confidence": number (0-1),
      "explanation": string
    }
  ],
  "personalizedMessage": string (empathetic message considering user's goals),
  "suggestedAction": "proceed" | "cooldown" | "skip"
}

Be empathetic but honest. Focus on helping the user achieve their financial goals.`;
}

function parseAIResponse(content: string, product: ProductInfo): AnalysisResult {
    try {
        // Extract JSON from response (handle markdown code blocks)
        let jsonStr = content;
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        }

        const parsed = JSON.parse(jsonStr.trim());
        const opportunityCost = calculateOpportunityCost(product.price, product.currency);

        return {
            isEssential: Boolean(parsed.isEssential),
            essentialityScore: Math.max(0, Math.min(1, Number(parsed.essentialityScore) || 0.5)),
            reasoning: String(parsed.reasoning || 'Unable to analyze'),
            warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((w: PricingWarning) => ({
                type: w.type || 'inflated_price',
                confidence: Math.max(0, Math.min(1, Number(w.confidence) || 0.5)),
                explanation: String(w.explanation || ''),
            })) : [],
            opportunityCost,
            personalizedMessage: String(parsed.personalizedMessage || 'Consider your financial goals before purchasing.'),
            suggestedAction: ['proceed', 'cooldown', 'skip'].includes(parsed.suggestedAction)
                ? parsed.suggestedAction
                : 'cooldown',
        };
    } catch {
        // Return fallback with calculated opportunity cost
        const opportunityCost = calculateOpportunityCost(product.price, product.currency);
        return {
            ...FALLBACK_ANALYSIS,
            opportunityCost,
        };
    }
}

export async function analyzePurchase(
    product: ProductInfo,
    userProfile?: UserProfile
): Promise<AnalysisResult> {
    try {
        const prompt = buildPrompt(product, userProfile);

        const response = await ai.models.generateContent({
            model: MODEL,
            contents: prompt,
        });

        const content = response.text || '';
        return parseAIResponse(content, product);
    } catch (error) {
        console.error('Gemini AI error:', error);

        // Return fallback response
        const opportunityCost = calculateOpportunityCost(product.price, product.currency);
        return {
            ...FALLBACK_ANALYSIS,
            opportunityCost,
        };
    }
}

export { buildPrompt, parseAIResponse, FALLBACK_ANALYSIS };
