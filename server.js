// FILE: server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdf = require('pdf-parse');
const OpenAI = require('openai');
const Tesseract = require('tesseract.js');
const fs = require('fs-extra');
const path = require('path');
const pdfPoppler = require('pdf-poppler');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

app.get('/', (req, res) => {
  res.send('Merchant Analysis API is running!');
});

app.post('/upload', upload.single('merchantStatement'), async (req, res) => {
  try {
    const pdfBuffer = req.file.buffer;
    const pdfData = await pdf(pdfBuffer);
    let pdfText = pdfData.text.trim();

    console.log('Extracted PDF Text:', pdfText);

    if (!pdfText) {
      console.log('No text found, converting PDF to image...');
      const tempPdfPath = path.join(__dirname, 'temp.pdf');
      await fs.writeFile(tempPdfPath, pdfBuffer);

      const outputImagePath = path.join(__dirname, 'temp.png');
      try {
        await pdfPoppler.convert(tempPdfPath, {
          format: 'png',
          out_dir: __dirname,
          out_prefix: 'temp',
          page: 1
        });
      } catch (err) {
        console.error('Error during PDF-to-image conversion:', err);
      }

      console.log('PDF converted to image, running OCR...');
      const ocrResult = await Tesseract.recognize(outputImagePath, 'eng');
      pdfText = ocrResult.data.text.trim();

      console.log('OCR Extracted Text:', pdfText);

      await fs.unlink(tempPdfPath).catch(() => {});
      await fs.unlink(outputImagePath).catch(() => {});
    }

    if (!pdfText) {
      return res.status(400).json({
        success: false,
        error: 'No readable text found in the PDF. Ensure it is text-based or a clearer scanned image.'
      });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert in financial analysis. Extract key insights from the following invoice and present the results as a **Markdown table**. ' +
            'The table must include: Card Type (Visa, MasterCard, Amex, Other), Transactions, Transaction Volume, IC+ Fees, Markup Fees, Chargebacks, IC+ %, and Markup %. ' +
            'Use "Other" instead of Interac, add a Totals row, format amounts as $XXX,XXX.XX, percentages as X.XX%, and return only **pure Markdown**, no explanations.'
        },
        {
          role: 'user',
          content: 'Here is the invoice text:\n' + pdfText
        }
      ],
      max_tokens: 750,
      temperature: 0.3
    });

    const analysis = response.choices[0].message.content.trim();
    res.json({ success: true, analysis });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server is listening on port ' + PORT);
});