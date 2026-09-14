import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";
import type { LongVideoWindowPlan } from "@/lib/professional-learning-video-long-window-planner";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R2 -- the
// EXACT window plan and raw per-window outputs captured from the one
// authorized real Gemini long-video acceptance run (professional-
// learning-video-l5r2-long-video-acceptance.test.ts, run 2026-09-14,
// providerRequestId "wBeoaqe7Asac3boPzM-eiQs", source video
// L5_R2_demonstratie_tuns_bob_11min.mp4, sha256
// 1221de974b414f18b02f6700076154d42e83e4e76467d616f3bb9c135a0c49ac,
// 671s / 11:11), hand-copied verbatim (via a one-off extraction script,
// never manually retyped) as literal fixtures and NEVER edited since.
//
// ABSOLUTE PROVENANCE RULE (mirrors Stage 8.5L5.R1's own
// professional-learning-video-l5r1-real-fixture.ts): these constants are
// the historically-true record of what Gemini originally, blindly
// observed across all 5 bounded windows -- never modified to make the
// video appear to have shown information it did not.

export const L5R2_REAL_WINDOW_PLAN: LongVideoWindowPlan = {
  "sourceEvidenceId": "66b5e27a-bb9b-4e8d-a777-a4f8eb211720",
  "totalDurationSeconds": 671,
  "segmentationVersion": "l5r2-long-video-v1",
  "contextMarginSeconds": 20,
  "windows": [
    {
      "id": "eda1b2466927dec29b01a964f8442b4ae4c415dca81191e78df8433b758fc883",
      "sourceEvidenceId": "66b5e27a-bb9b-4e8d-a777-a4f8eb211720",
      "index": 0,
      "coreInterval": {
        "timeStartSeconds": 0,
        "timeEndSeconds": 134
      },
      "contextInterval": {
        "timeStartSeconds": 0,
        "timeEndSeconds": 154
      },
      "segmentationVersion": "l5r2-long-video-v1"
    },
    {
      "id": "7278f22a077cfb296ec3b47e63d61dae5b5fb0ff878ec8b4bda11bded316a776",
      "sourceEvidenceId": "66b5e27a-bb9b-4e8d-a777-a4f8eb211720",
      "index": 1,
      "coreInterval": {
        "timeStartSeconds": 134,
        "timeEndSeconds": 268
      },
      "contextInterval": {
        "timeStartSeconds": 114,
        "timeEndSeconds": 288
      },
      "segmentationVersion": "l5r2-long-video-v1"
    },
    {
      "id": "3b11481c68c69ce7cf304a066a973b39cd301615ebc77d96a8d58e1aa56fa7df",
      "sourceEvidenceId": "66b5e27a-bb9b-4e8d-a777-a4f8eb211720",
      "index": 2,
      "coreInterval": {
        "timeStartSeconds": 268,
        "timeEndSeconds": 403
      },
      "contextInterval": {
        "timeStartSeconds": 248,
        "timeEndSeconds": 423
      },
      "segmentationVersion": "l5r2-long-video-v1"
    },
    {
      "id": "64578d646b38af11b632eda8b63ef3f323584a0ff6c8816e9e411d404637d0bb",
      "sourceEvidenceId": "66b5e27a-bb9b-4e8d-a777-a4f8eb211720",
      "index": 3,
      "coreInterval": {
        "timeStartSeconds": 403,
        "timeEndSeconds": 537
      },
      "contextInterval": {
        "timeStartSeconds": 383,
        "timeEndSeconds": 557
      },
      "segmentationVersion": "l5r2-long-video-v1"
    },
    {
      "id": "b77ee6ddf4cb665853be3061a8c6cbdf1501a53c7b876b61b72f956ede48cfd7",
      "sourceEvidenceId": "66b5e27a-bb9b-4e8d-a777-a4f8eb211720",
      "index": 4,
      "coreInterval": {
        "timeStartSeconds": 537,
        "timeEndSeconds": 671
      },
      "contextInterval": {
        "timeStartSeconds": 517,
        "timeEndSeconds": 671
      },
      "segmentationVersion": "l5r2-long-video-v1"
    }
  ]
};

export const L5R2_REAL_RAW_RESULTS_BY_WINDOW_ID: Readonly<Record<string, ProfessionalLearningExtractorOutput>> = {
  "eda1b2466927dec29b01a964f8442b4ae4c415dca81191e78df8433b758fc883": {
    "discernment": {
      "category": "PROFESSIONAL_TECHNIQUE",
      "reason": "The video demonstrates a structured hair cutting technique starting from dry hair assessment, wet sectioning along a center parting, taking horizontal/diagonal sub-sections at the nape and side, elevating hair, and cutting using scissors with the previous section as a guide."
    },
    "extraction": {
      "domain": {
        "value": "hairdressing",
        "source": "OBSERVED",
        "confidence": 0.99,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 234,
            "relevance": 1
          }
        ]
      },
      "discipline": {
        "value": "hair cutting",
        "source": "OBSERVED",
        "confidence": 0.99,
        "segments": [
          {
            "timeStartSeconds": 46,
            "timeEndSeconds": 234,
            "relevance": 1
          }
        ]
      },
      "techniqueCandidate": {
        "value": "graduated haircut",
        "source": "INFERRED",
        "confidence": 0.9,
        "note": "Voiceover describes cutting a graduated line with slight elevation.",
        "segments": [
          {
            "timeStartSeconds": 46,
            "timeEndSeconds": 155,
            "relevance": 1
          }
        ]
      },
      "startingState": {
        "value": "dry hair initially, then wet damp hair divided into sections",
        "source": "OBSERVED",
        "confidence": 0.95,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 26,
            "relevance": 1
          }
        ]
      },
      "applicableZones": {
        "value": "nape and back side zones",
        "source": "OBSERVED",
        "confidence": 0.95,
        "segments": [
          {
            "timeStartSeconds": 46,
            "timeEndSeconds": 225,
            "relevance": 1
          }
        ]
      },
      "sectioning": {
        "value": "center profile parting to center back",
        "source": "OBSERVED",
        "confidence": 0.9,
        "segments": [
          {
            "timeStartSeconds": 16,
            "timeEndSeconds": 26,
            "relevance": 1
          }
        ]
      },
      "subsectioning": {
        "value": "horizontal to slightly diagonal sub-sections",
        "source": "OBSERVED",
        "confidence": 0.9,
        "segments": [
          {
            "timeStartSeconds": 46,
            "timeEndSeconds": 135,
            "relevance": 1
          }
        ]
      },
      "guideType": {
        "value": "mobile guide",
        "source": "INFERRED",
        "confidence": 0.85,
        "note": "Voiceover states using the previous section as a guide for length.",
        "segments": [
          {
            "timeStartSeconds": 109,
            "timeEndSeconds": 125,
            "relevance": 1
          }
        ]
      },
      "elevation": {
        "value": "low to progressively higher elevation",
        "source": "INFERRED",
        "confidence": 0.85,
        "note": "Voiceover notes lifting each section slightly higher as working up the head.",
        "segments": [
          {
            "timeStartSeconds": 46,
            "timeEndSeconds": 155,
            "relevance": 1
          }
        ]
      },
      "tool": {
        "value": "cutting scissors, comb",
        "source": "OBSERVED",
        "confidence": 0.98,
        "note": "White comb and metal cutting shears visible.",
        "segments": [
          {
            "timeStartSeconds": 16,
            "timeEndSeconds": 234,
            "relevance": 1
          }
        ]
      },
      "fingerPosition": {
        "value": "holding hair flat between index and middle fingers parallel to section line",
        "source": "OBSERVED",
        "confidence": 0.95,
        "segments": [
          {
            "timeStartSeconds": 46,
            "timeEndSeconds": 225,
            "relevance": 1
          }
        ]
      }
    },
    "comparisonSkillIdHint": null,
    "relatedSkillIdHints": [],
    "temporalObservations": [
      {
        "timeStartSeconds": 0,
        "timeEndSeconds": 16,
        "observation": "Operator combs dry red hair on a seated model and moves hands through it from different angles."
      },
      {
        "timeStartSeconds": 16,
        "timeEndSeconds": 26,
        "observation": "Model's hair is wet; operator uses a white comb to divide hair along a top center line down toward the back."
      },
      {
        "timeStartSeconds": 26,
        "timeEndSeconds": 46,
        "observation": "Operator separates hair into sections around the side and back using a comb and fingers."
      },
      {
        "timeStartSeconds": 46,
        "timeEndSeconds": 58,
        "observation": "Operator combs a horizontal section at the nape area, lifts hair between index and middle fingers, and cuts across with scissors."
      },
      {
        "timeStartSeconds": 58,
        "timeEndSeconds": 109,
        "observation": "Operator combs hair down, checks line, takes a second section directly above, holds hair lifted, and cuts across with scissors."
      },
      {
        "timeStartSeconds": 109,
        "timeEndSeconds": 155,
        "observation": "Operator continues taking higher sections along the side/back, lifting hair out from head and cutting along the previously cut edge."
      },
      {
        "timeStartSeconds": 155,
        "timeEndSeconds": 225,
        "observation": "Operator works up through additional sections above the ear/back, holding hair away from the scalp and cutting with scissors."
      },
      {
        "timeStartSeconds": 225,
        "timeEndSeconds": 234,
        "observation": "Operator shifts to the opposite side of the head, taking a section and holding it between fingers with scissors prepared."
      }
    ],
    "actionCandidates": [
      {
        "timeStartSeconds": 0,
        "timeEndSeconds": 16,
        "kind": "INSPECTION"
      },
      {
        "timeStartSeconds": 16,
        "timeEndSeconds": 46,
        "kind": "COMBING"
      },
      {
        "timeStartSeconds": 46,
        "timeEndSeconds": 58,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 58,
        "timeEndSeconds": 109,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 109,
        "timeEndSeconds": 225,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 225,
        "timeEndSeconds": 234,
        "kind": "REPOSITIONING"
      }
    ],
    "notableEditsOrCuts": [
      {
        "beforeTimeSeconds": 8,
        "afterTimeSeconds": 9
      },
      {
        "beforeTimeSeconds": 16,
        "afterTimeSeconds": 17
      },
      {
        "beforeTimeSeconds": 25,
        "afterTimeSeconds": 26
      },
      {
        "beforeTimeSeconds": 39,
        "afterTimeSeconds": 40
      },
      {
        "beforeTimeSeconds": 44,
        "afterTimeSeconds": 45
      },
      {
        "beforeTimeSeconds": 109,
        "afterTimeSeconds": 110
      },
      {
        "beforeTimeSeconds": 205,
        "afterTimeSeconds": 206
      },
      {
        "beforeTimeSeconds": 213,
        "afterTimeSeconds": 214
      },
      {
        "beforeTimeSeconds": 225,
        "afterTimeSeconds": 226
      }
    ]
  },
  "7278f22a077cfb296ec3b47e63d61dae5b5fb0ff878ec8b4bda11bded316a776": {
    "discernment": {
      "category": "PROFESSIONAL_TECHNIQUE",
      "reason": "The video explicitly demonstrates precision hair cutting techniques including diagonal sectioning, overdirection, guideline creation, and vertical refinement to remove weight, accompanied by descriptive professional commentary."
    },
    "extraction": {
      "domain": {
        "value": "HAIR",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 167,
            "relevance": 1
          }
        ]
      },
      "discipline": {
        "value": "CUTTING",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 167,
            "relevance": 1
          }
        ]
      },
      "techniqueCandidate": {
        "value": "Graduated undercut haircut with back overdirection and corner weight refinement",
        "source": "INFERRED",
        "confidence": 0.92,
        "note": "Combines diagonal sectioning, overdirection to a stationary guide, and vertical top corner removal.",
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 167,
            "relevance": 1
          }
        ]
      },
      "professionalObjective": {
        "value": "Create subtle undercutting and graduation while removing excess weight at top corners for balanced symmetry",
        "source": "OBSERVED",
        "confidence": 0.95,
        "note": "Spoken directly in narration during technique execution.",
        "segments": [
          {
            "timeStartSeconds": 60,
            "timeEndSeconds": 167,
            "relevance": 1
          }
        ]
      },
      "sectioning": {
        "value": "Diagonal sectioning through side/temple and vertical elevation on top section",
        "source": "OBSERVED",
        "confidence": 0.95,
        "segments": [
          {
            "timeStartSeconds": 60,
            "timeEndSeconds": 167,
            "relevance": 1
          }
        ]
      },
      "guideType": {
        "value": "Stationary guideline",
        "source": "OBSERVED",
        "confidence": 0.9,
        "note": "Voiceover specifies overdirecting all subsequent hair back onto the first cutting line.",
        "segments": [
          {
            "timeStartSeconds": 80,
            "timeEndSeconds": 127,
            "relevance": 1
          }
        ]
      },
      "overdirection": {
        "value": "Overdirected backward onto initial temple guideline",
        "source": "OBSERVED",
        "confidence": 0.95,
        "note": "Voiceover states all hair from front hairline is overdirected back to the first section.",
        "segments": [
          {
            "timeStartSeconds": 80,
            "timeEndSeconds": 127,
            "relevance": 1
          }
        ]
      },
      "tool": {
        "value": "Scissors and cutting comb",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 167,
            "relevance": 1
          }
        ]
      },
      "elevation": {
        "value": null,
        "source": "UNKNOWN"
      },
      "crossCheck": {
        "value": "Visual assessment and tactile checking for shape balance and symmetry",
        "source": "OBSERVED",
        "confidence": 0.9,
        "note": "Narrator notes operator checks shape so far for balance and symmetry.",
        "segments": [
          {
            "timeStartSeconds": 51,
            "timeEndSeconds": 60,
            "relevance": 1
          }
        ]
      }
    },
    "comparisonSkillIdHint": null,
    "relatedSkillIdHints": [],
    "temporalObservations": [
      {
        "timeStartSeconds": 0,
        "timeEndSeconds": 25,
        "observation": "Operator holds a section of hair diagonally behind the ear using a comb and fingers, then cuts the section ends using shears."
      },
      {
        "timeStartSeconds": 25,
        "timeEndSeconds": 31,
        "observation": "Operator uses fingers to stroke and feel the cut hair at the back and nape area."
      },
      {
        "timeStartSeconds": 31,
        "timeEndSeconds": 51,
        "observation": "On the opposite side, operator combs diagonal sections of hair, holds them between fingers, and trims the ends with scissors."
      },
      {
        "timeStartSeconds": 51,
        "timeEndSeconds": 60,
        "observation": "Operator runs fingers through the hair at the back of the model's head to inspect the overall fall and shape."
      },
      {
        "timeStartSeconds": 60,
        "timeEndSeconds": 80,
        "observation": "Operator separates a diagonal section near the temple, pulls the hair backward, and cuts a new edge line."
      },
      {
        "timeStartSeconds": 80,
        "timeEndSeconds": 127,
        "observation": "Operator pulls subsequent parallel sections back toward the previously cut section and cuts the ends parallel to the guide line."
      },
      {
        "timeStartSeconds": 127,
        "timeEndSeconds": 140,
        "observation": "Operator combs the side hair downward and inspects the visual silhouette."
      },
      {
        "timeStartSeconds": 140,
        "timeEndSeconds": 167,
        "observation": "Operator elevates a top section vertically upward between fingers and trims protruding corner hair along the edge."
      }
    ],
    "actionCandidates": [
      {
        "timeStartSeconds": 0,
        "timeEndSeconds": 25,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 25,
        "timeEndSeconds": 31,
        "kind": "INSPECTION"
      },
      {
        "timeStartSeconds": 31,
        "timeEndSeconds": 51,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 51,
        "timeEndSeconds": 60,
        "kind": "INSPECTION"
      },
      {
        "timeStartSeconds": 60,
        "timeEndSeconds": 127,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 127,
        "timeEndSeconds": 140,
        "kind": "INSPECTION"
      },
      {
        "timeStartSeconds": 140,
        "timeEndSeconds": 167,
        "kind": "CUTTING_ACTION"
      }
    ],
    "notableEditsOrCuts": [
      {
        "beforeTimeSeconds": 5,
        "afterTimeSeconds": 6
      },
      {
        "beforeTimeSeconds": 12,
        "afterTimeSeconds": 13
      },
      {
        "beforeTimeSeconds": 20,
        "afterTimeSeconds": 21
      },
      {
        "beforeTimeSeconds": 25,
        "afterTimeSeconds": 26
      },
      {
        "beforeTimeSeconds": 31,
        "afterTimeSeconds": 32
      },
      {
        "beforeTimeSeconds": 51,
        "afterTimeSeconds": 52
      },
      {
        "beforeTimeSeconds": 60,
        "afterTimeSeconds": 61
      },
      {
        "beforeTimeSeconds": 80,
        "afterTimeSeconds": 81
      },
      {
        "beforeTimeSeconds": 127,
        "afterTimeSeconds": 128
      },
      {
        "beforeTimeSeconds": 140,
        "afterTimeSeconds": 141
      }
    ]
  },
  "3b11481c68c69ce7cf304a066a973b39cd301615ebc77d96a8d58e1aa56fa7df": {
    "discernment": {
      "category": "PROFESSIONAL_TECHNIQUE",
      "reason": "The video demonstrates a structured professional hair cutting procedure involving precise sectioning, vertical elevation on top sections, horizontal perimeter trimming, and diagonal side overdirection using scissors and comb."
    },
    "extraction": {
      "domain": {
        "value": "HAIR",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 70,
            "relevance": 1
          }
        ]
      },
      "discipline": {
        "value": "HAIRCUTTING",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 70,
            "relevance": 1
          }
        ]
      },
      "techniqueCandidate": {
        "value": "Graduated bob refinement with top elevation and perimeter shape connection",
        "source": "INFERRED",
        "confidence": 0.85,
        "note": "Extracted based on observed vertical top layering and horizontal side perimeter cutting.",
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 70,
            "relevance": 1
          }
        ]
      },
      "tool": {
        "value": "Haircutting scissors and comb",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 70,
            "relevance": 1
          }
        ]
      },
      "guideType": {
        "value": null,
        "source": "UNKNOWN"
      }
    },
    "comparisonSkillIdHint": null,
    "relatedSkillIdHints": [],
    "temporalObservations": [
      {
        "timeStartSeconds": 0,
        "timeEndSeconds": 6,
        "observation": "A side section of hair is combed horizontally outward, held between fingers, and trimmed near the ends with scissors."
      },
      {
        "timeStartSeconds": 6,
        "timeEndSeconds": 13,
        "observation": "The operator combs through the side hair downward and visually inspects the hair drape."
      },
      {
        "timeStartSeconds": 13,
        "timeEndSeconds": 22,
        "observation": "A section of hair on top of the head is combed straight upward, held between fingers, and trimmed across the top with scissors."
      },
      {
        "timeStartSeconds": 22,
        "timeEndSeconds": 43,
        "observation": "Top sections of hair continue to be lifted vertically and trimmed along finger lines."
      },
      {
        "timeStartSeconds": 43,
        "timeEndSeconds": 52,
        "observation": "A side section is combed forward and downward, then trimmed with scissors near the lower edge."
      },
      {
        "timeStartSeconds": 52,
        "timeEndSeconds": 63,
        "observation": "Hair section near the side ear level is combed down flat and trimmed along a horizontal comb line."
      },
      {
        "timeStartSeconds": 63,
        "timeEndSeconds": 70,
        "observation": "A top-front section is combed diagonally forward, held between fingers, and prepared for cutting."
      }
    ],
    "actionCandidates": [
      {
        "timeStartSeconds": 0,
        "timeEndSeconds": 3,
        "kind": "COMBING"
      },
      {
        "timeStartSeconds": 3,
        "timeEndSeconds": 6,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 6,
        "timeEndSeconds": 13,
        "kind": "INSPECTION"
      },
      {
        "timeStartSeconds": 13,
        "timeEndSeconds": 16,
        "kind": "COMBING"
      },
      {
        "timeStartSeconds": 16,
        "timeEndSeconds": 43,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 43,
        "timeEndSeconds": 52,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 52,
        "timeEndSeconds": 63,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 63,
        "timeEndSeconds": 70,
        "kind": "REPOSITIONING"
      }
    ],
    "notableEditsOrCuts": [
      {
        "beforeTimeSeconds": 6,
        "afterTimeSeconds": 7
      },
      {
        "beforeTimeSeconds": 13,
        "afterTimeSeconds": 14
      },
      {
        "beforeTimeSeconds": 43,
        "afterTimeSeconds": 44
      },
      {
        "beforeTimeSeconds": 45,
        "afterTimeSeconds": 46
      },
      {
        "beforeTimeSeconds": 52,
        "afterTimeSeconds": 53
      },
      {
        "beforeTimeSeconds": 63,
        "afterTimeSeconds": 64
      }
    ]
  },
  "64578d646b38af11b632eda8b63ef3f323584a0ff6c8816e9e411d404637d0bb": {
    "discernment": {
      "category": "PROFESSIONAL_TECHNIQUE",
      "reason": "The video demonstrates specific hair cutting actions including wet sectioning, overdirected cutting, and dry point-cutting/texturizing at the nape."
    },
    "extraction": {
      "domain": {
        "value": "hairdressing",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 174,
            "relevance": 1
          }
        ]
      },
      "discipline": {
        "value": "haircutting",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 174,
            "relevance": 1
          }
        ]
      },
      "techniqueCandidate": {
        "value": "overdirected layered cutting and dry perimeter point cutting",
        "source": "INFERRED",
        "confidence": 0.9,
        "note": "Extracted from visible sequence of elevated cutting followed by dry texturizing.",
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 174,
            "relevance": 1
          }
        ]
      },
      "tool": {
        "value": "comb",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 174,
            "relevance": 1
          }
        ]
      },
      "fingerPosition": {
        "value": "holding hair section between index and middle finger",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 174,
            "relevance": 1
          }
        ]
      },
      "applicableZones": {
        "value": "sides, top, nape",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 174,
            "relevance": 1
          }
        ]
      },
      "startingState": {
        "value": "wet hair in first segment, dry hair in second segment",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 174,
            "relevance": 1
          }
        ]
      },
      "elevation": {
        "value": null,
        "source": "UNKNOWN"
      },
      "overdirection": {
        "value": "drawn forward and outward relative to original growth plane",
        "source": "INFERRED",
        "confidence": 0.85,
        "note": "Narrator explicitly mentions overdirection and visual placement confirms hair pulled relative to plane.",
        "segments": [
          {
            "timeStartSeconds": 45,
            "timeEndSeconds": 75,
            "relevance": 1
          }
        ]
      }
    },
    "comparisonSkillIdHint": null,
    "relatedSkillIdHints": [],
    "temporalObservations": [
      {
        "timeStartSeconds": 0,
        "timeEndSeconds": 22,
        "observation": "Operator holds a horizontal-diagonal wet section of hair pulled outward and cuts along fingers with scissors while narrator discusses beveling and undercutting."
      },
      {
        "timeStartSeconds": 22,
        "timeEndSeconds": 45,
        "observation": "Operator parts a top section of hair, holds hair elevated outward, and cuts hair ends."
      },
      {
        "timeStartSeconds": 45,
        "timeEndSeconds": 75,
        "observation": "Operator combs parallel upper hair sections forward and outward, cutting along fingers."
      },
      {
        "timeStartSeconds": 75,
        "timeEndSeconds": 115,
        "observation": "Video transitions to model with dry hair. Operator holds hair flat against the nape with fingers and cuts vertically into the bottom perimeter line with scissors."
      },
      {
        "timeStartSeconds": 115,
        "timeEndSeconds": 174,
        "observation": "Operator lifts hair at the nape with comb and fingers, holding scissor blades perpendicular to the hair section to snip into hair ends."
      }
    ],
    "actionCandidates": [
      {
        "timeStartSeconds": 0,
        "timeEndSeconds": 22,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 22,
        "timeEndSeconds": 45,
        "kind": "REPOSITIONING"
      },
      {
        "timeStartSeconds": 45,
        "timeEndSeconds": 75,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 75,
        "timeEndSeconds": 115,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 115,
        "timeEndSeconds": 174,
        "kind": "CUTTING_ACTION"
      }
    ],
    "notableEditsOrCuts": [
      {
        "beforeTimeSeconds": 22,
        "afterTimeSeconds": 23
      },
      {
        "beforeTimeSeconds": 75,
        "afterTimeSeconds": 76
      }
    ]
  },
  "b77ee6ddf4cb665853be3061a8c6cbdf1501a53c7b876b61b72f956ede48cfd7": {
    "discernment": {
      "category": "PROFESSIONAL_TECHNIQUE",
      "reason": "The video demonstrates specific hair cutting and texturizing techniques including point cutting and slicing on a bob haircut, accompanied by narration explaining the method and rationale."
    },
    "extraction": {
      "domain": {
        "value": "HAIR",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 113,
            "relevance": 1
          }
        ]
      },
      "discipline": {
        "value": "HAIRCUTTING",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 113,
            "relevance": 1
          }
        ]
      },
      "techniqueCandidate": {
        "value": "Point cutting and slicing for texturizing a bob",
        "source": "INFERRED",
        "confidence": 0.95,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 91,
            "relevance": 1
          }
        ]
      },
      "tool": {
        "value": "scissors, comb, hair clip, paddle brush",
        "source": "OBSERVED",
        "confidence": 1,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 113,
            "relevance": 1
          }
        ]
      },
      "targetEffect": {
        "value": "Remove density and weight without losing perimeter length",
        "source": "INFERRED",
        "confidence": 0.9,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 91,
            "relevance": 1
          }
        ]
      },
      "applicableZones": {
        "value": "Nape, sides, top, perimeter",
        "source": "OBSERVED",
        "confidence": 0.95,
        "segments": [
          {
            "timeStartSeconds": 0,
            "timeEndSeconds": 91,
            "relevance": 1
          }
        ]
      }
    },
    "comparisonSkillIdHint": null,
    "relatedSkillIdHints": [],
    "temporalObservations": [
      {
        "timeStartSeconds": 0,
        "timeEndSeconds": 9,
        "observation": "The operator holds a comb in one hand and uses fingers to hold hair flat near the nape while cutting vertically into the hair ends with scissors."
      },
      {
        "timeStartSeconds": 9,
        "timeEndSeconds": 21,
        "observation": "Close-up view of hair held between fingers with scissors cutting vertically into the tips perpendicular to the finger line."
      },
      {
        "timeStartSeconds": 21,
        "timeEndSeconds": 27,
        "observation": "The model's head is shown from the side displaying the short hair length above the shoulders."
      },
      {
        "timeStartSeconds": 27,
        "timeEndSeconds": 47,
        "observation": "The operator holds scissors partially open and glides the blades down through a vertical section of hair near the side/back."
      },
      {
        "timeStartSeconds": 47,
        "timeEndSeconds": 54,
        "observation": "The operator uses scissors and comb near the nape line to cut fine details along the bottom hair edge."
      },
      {
        "timeStartSeconds": 54,
        "timeEndSeconds": 68,
        "observation": "The operator combs a side section out from the head, holds it in fingers, and cuts vertically into the ends."
      },
      {
        "timeStartSeconds": 68,
        "timeEndSeconds": 80,
        "observation": "Hair near the ear is comb-held against the neck and clipped at the ends using point cuts."
      },
      {
        "timeStartSeconds": 80,
        "timeEndSeconds": 91,
        "observation": "A section from the upper head is held straight up between fingers and clipped vertically at the tips."
      },
      {
        "timeStartSeconds": 91,
        "timeEndSeconds": 113,
        "observation": "The operator uses a paddle brush and hands to shake, lift, and style the red short bob haircut."
      }
    ],
    "actionCandidates": [
      {
        "timeStartSeconds": 0,
        "timeEndSeconds": 21,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 27,
        "timeEndSeconds": 47,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 54,
        "timeEndSeconds": 91,
        "kind": "CUTTING_ACTION"
      },
      {
        "timeStartSeconds": 91,
        "timeEndSeconds": 113,
        "kind": "STYLING_ACTION"
      }
    ],
    "notableEditsOrCuts": [
      {
        "beforeTimeSeconds": 9,
        "afterTimeSeconds": 10
      },
      {
        "beforeTimeSeconds": 21,
        "afterTimeSeconds": 22
      },
      {
        "beforeTimeSeconds": 27,
        "afterTimeSeconds": 28
      },
      {
        "beforeTimeSeconds": 47,
        "afterTimeSeconds": 48
      },
      {
        "beforeTimeSeconds": 54,
        "afterTimeSeconds": 55
      },
      {
        "beforeTimeSeconds": 68,
        "afterTimeSeconds": 69
      },
      {
        "beforeTimeSeconds": 80,
        "afterTimeSeconds": 81
      },
      {
        "beforeTimeSeconds": 91,
        "afterTimeSeconds": 92
      }
    ]
  }
};
