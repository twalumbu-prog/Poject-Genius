# Vision Regression Suite

This directory contains the automated testing harness for the Project Genius Vision Pipeline (Stages 0-D).

## Directory Structure
- `groundTruth/`: Contains JSON files mapping image filenames to expected answers.
- `regressionRunner.js`: Logic to execute the pipeline on images and compare against ground truth.
- `reportTemplate.html`: Visual report generator for regression results.

## How to Run
1. Place your test images in this folder or a subfolder.
2. Create a JSON file in `groundTruth/` matching the image filenames.
3. Use the **Diagnostic Panel** in the application (Teacher -> Diagnostics) to run the batch regression.

## Ground Truth Schema
```json
{
  "test_set_name": "Standard OMR A1",
  "cases": [
    {
      "filename": "script_001.jpg",
      "expected": {
        "studentName": "John Doe",
        "answers": [
          { "question_number": 1, "student_answer": "A" },
          { "question_number": 2, "student_answer": "C" }
        ]
      }
    }
  ]
}
```
