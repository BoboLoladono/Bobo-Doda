import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateJobDto } from './create-job.dto';
import { CreateProposalDto } from './create-proposal.dto';

describe('job input boundaries', () => {
  const job = { category: 'design', title: 'Valid job', description: 'A sufficiently detailed description', budgetMin: 1000, budgetMax: 2000 };
  const errors = (type: typeof CreateJobDto, values: object) => validate(plainToInstance(type, values));
  it('rejects malformed dates instead of silently discarding the deadline', async () => {
    expect(await errors(CreateJobDto, { ...job, deadline: 'tomorrow-ish' })).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'deadline' })]));
  });
  it('trims before checking minimum text lengths', async () => {
    expect(await errors(CreateJobDto, { ...job, title: '      ' })).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'title' })]));
  });
  it('bounds uploaded references', async () => {
    expect(await errors(CreateJobDto, { ...job, attachedImages: Array(11).fill('file') })).not.toHaveLength(0);
  });
  it('validates nested answers and cover-letter size', async () => {
    const dto = plainToInstance(CreateProposalDto, { bidAmount: 1000, coverLetter: 'x'.repeat(5001), screeningAnswers: [{ question: 'Q', answer: 123 }] });
    const found = await validate(dto);
    expect(found.map((e) => e.property)).toEqual(expect.arrayContaining(['coverLetter', 'screeningAnswers']));
  });
});
