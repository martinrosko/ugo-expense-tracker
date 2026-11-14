-- Rename TransactionTag to TagObject (keeps data)
ALTER TABLE "TransactionTag" RENAME TO "TagObject";
ALTER TABLE "TagObject" RENAME CONSTRAINT "TransactionTag_pkey" TO "TagObject_pkey";
ALTER TABLE "TagObject" RENAME CONSTRAINT "TransactionTag_transactionId_fkey" TO "TagObject_transactionId_fkey";
ALTER TABLE "TagObject" RENAME CONSTRAINT "TransactionTag_tagId_fkey" TO "TagObject_tagId_fkey";
ALTER INDEX "TransactionTag_transactionId_tagId_key" RENAME TO "TagObject_transactionId_tagId_key";
