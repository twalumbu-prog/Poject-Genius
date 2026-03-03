import fs from 'fs';

async function run() {
    try {
        const body = {
            mode: 'mark_script',
            image: "data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDMgMCBSL0ZpbHRlci9GbGF0ZURlY29kZT4+CnN0cmVhbQp4nDPQM1Qo5yihKOUw1LPRK0vM10vOz9UrycxN1U8pSi0uTk1R0FWoTQWygzxDXYtSc3WKUvNKVQ20QJIF2UA+iK+mxaEIFDI2UgCLoheFCgplbmRzdHJlYW0KZW5kb2JqCgozIDAgb2JqCjgwCmVuZG9iagoKNCAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDU5NSA4NDJdL1JvdGF0ZSAwL1BhcmVudCA1IDAgUi9SZXNvdXJjZXM8PC9Qcm9jU2V0Wy9QREYvVGV4dF0+Pi9Db250ZW50cyAyIDAgUj4+CmVuZG9iagoKNSAwIG9iago8PC9UeXBlL0Vudmlyb25tZW50L0tpZHNbNCAwIFJdL0NvdW50IDE+PgplbmRvYmoKCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDUgMCBSPj4KZW5kb2JqCgo2IDAgb2JqCjw8L1Byb2R1Y2VyKG11UERGIDEuMTgpL0NyZWF0b3IoRGVibWFjaGluZSkvQ3JlYXRpb25EYXRlKEQ6MjAyMzA2MjUxNDEyMTdaKT4+CmVuZG9iagoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowDAwMDAwMDI4MCAwMDAwMCBuIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAxNDkgMDAwMDAgbiAKMDAwMDAwMDE2OCAwMDAwMCBuIAowMDAwMDAwMjQ5IDAwMDAwIG4gCjAwMDAwMDAzMDcgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDcvUm9vdCAxIDAgUi9JbmZvIDYgMCBSPj4Kc3RhcnR4cmVmCjQyOAolJUVPRgo=",
            markingScheme: [
                {
                    "question_number": 1,
                    "correct_answer": "A",
                    "topic": "Math"
                }
            ]
        };
        const response = await fetch('https://gjiuseoqtzhdvxwvktfo.supabase.co/functions/v1/process-test-ai', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify(body)
        });
        
        console.log("Status:", response.status);
        const text = await response.text();
        console.log("Response:", text);
    } catch (e) {
        console.error("Fetch threw:", e);
    }
}
run();
