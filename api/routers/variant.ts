import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { analyzeVariant } from "../services/variantAnalyzer";

export const variantRouter = createRouter({
  analyze: publicQuery
    .input(
      z.object({
        variant: z.string().min(1).max(500),
        options: z
          .object({
            includeGnomad: z.boolean().default(true),
            includeClinvar: z.boolean().default(true),
            includeLiterature: z.boolean().default(true),
            includeEve: z.boolean().default(true),
            secondVariantPathogenic: z.boolean().default(false),
          })
          .default(() => ({
            includeGnomad: true,
            includeClinvar: true,
            includeLiterature: true,
            includeEve: true,
            secondVariantPathogenic: false,
          })),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await analyzeVariant(input.variant, input.options);
        return { success: true as const, data: result };
      } catch (err: any) {
        return {
          success: false as const,
          error: err?.message ?? "Unknown error",
        };
      }
    }),
});
