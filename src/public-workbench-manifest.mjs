const manifest = {
  schemaVersion: "public-synthetic-candidate-manifest/v1",
  candidateFields: [
    "id",
    "title",
    "businessChange",
    "rule",
    "question",
    "sourceLabel",
    "participantLabel",
    "eventType",
    "occurredAt",
    "minimumEvidence",
    "evidence",
    "recommendation",
  ],
  evidenceFields: ["id", "revision", "fingerprint"],
  conflictClaimFields: ["statement", "sourceLabel"],
  candidates: [
    {
      id: "synthetic-candidate-01",
      hasConflictingClaims: false,
      candidateDigest: "1c53f851fb663df1915114d5bd936226da44d8288a19fd0eaa6011522a879a23",
      evidenceSetDigest: "b79d61ce80274a61943cf6431e79a16457682a22e709208f796f2a7f0fd4abb5",
      sourceDiffDigest: "8e9eef10ca119647d9b57e19c3c87f925cfaee9a5dd9e2f6287b1a79190da851",
    },
    {
      id: "synthetic-candidate-02",
      hasConflictingClaims: false,
      candidateDigest: "b83c5625eaf785cbcea13b2909472ce592bb224e920aa8aa2f50ecef8c537131",
      evidenceSetDigest: "6698850714385936477a1ba94bfe49eb0d5cab0a4b99094934451f9b3d8ed130",
      sourceDiffDigest: "5d237a345675d928810e6d11f088dab7fe0d7ce5f5ce6e9915a656004122d6cd",
    },
    {
      id: "synthetic-candidate-03",
      hasConflictingClaims: false,
      candidateDigest: "2c572cb520610f95c8850ef33712d52d9d5ab22fa86b7dfeac76628acb9628ed",
      evidenceSetDigest: "0990fe4a1621b68589a53d1160453bb787ad2732872e657ae2cdac0e68ffe4bb",
      sourceDiffDigest: "84d070d456e307bf15d5f11bb8be611f2fc8c47fe396a55e662c63d232f34de2",
    },
    {
      id: "synthetic-candidate-04",
      hasConflictingClaims: false,
      candidateDigest: "7a2692d14eef17b598824abc4552fe21146489a26f73f606a82c9e2b71885e3e",
      evidenceSetDigest: "d6decb512f5ccc223de7c4a5b608aa1965454d42aa9d8126f856c4577751bac7",
      sourceDiffDigest: "194e785487d1112723822c1cd266e7ae6d83f2e3ce0f669cc974c226125e6b54",
    },
    {
      id: "synthetic-candidate-05",
      hasConflictingClaims: false,
      candidateDigest: "c30bf4ddc3aafab163f2a33e43a4c1ebd70a81acad7af846f4b52f48a35eda03",
      evidenceSetDigest: "836e968bedd0508cdd1aced56c00ed44bd1f4fdf8268c5f0783b2a2a54276b6f",
      sourceDiffDigest: "35d74a0fec9fe88a84a265cd7eeff857bd0294b95e9ca1449e02b169ed1080cc",
    },
    {
      id: "synthetic-candidate-06",
      hasConflictingClaims: true,
      candidateDigest: "a0247c4c73f77a4ecad19d7cafb9bfe7dba924be1bbefb25e1e73ad4d40c5cd5",
      evidenceSetDigest: "453a297bc4683b815453ad467559e5db43f6549f446a198e974beb68da165a6f",
      sourceDiffDigest: "0aafb47db1dcc87018184973aa711185f27d30e26270235d748294fc93135f97",
    },
    {
      id: "synthetic-candidate-07",
      hasConflictingClaims: false,
      candidateDigest: "2d9a5e9cc2f28f4eed698fb0cb2c34333653e1bbe8d1b37d46a9a53c0682f105",
      evidenceSetDigest: "49ca951c3668a501e6f8b94b44e4c776720139d93bf26015318c2647e1bf6888",
      sourceDiffDigest: "5c196b90323f76a48a1134696229856ba01009d5262494fd994b486d5066a59a",
    },
  ],
  setDigest: "e6a97eaf624d70ac907fd7478ebd2de460539a027bbbd0f30393584531afd88b",
  manifestDigest: "35e02f1881c657266b1adc000577d7b54fac00c73df864847ffef3725ed396b4",
};

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const PUBLIC_CANDIDATE_MANIFEST = freeze(manifest);
