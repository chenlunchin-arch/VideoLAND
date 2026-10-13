import { Injectable, Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

// 用 AWS SES 寄信，跟其他 AWS 服務共用同一組帳號/region，不用另外接第三方郵件服務。
// 如果專案改用 SendGrid/Postmark 之類的服務，把這個 class 內部實作換掉即可，
// 呼叫方（renewal-reminder.service.ts）不用改。
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly ses = new SESClient({ region: process.env.AWS_REGION });

  async send(to: string, subject: string, bodyText: string) {
    try {
      await this.ses.send(
        new SendEmailCommand({
          Source: process.env.SES_FROM_ADDRESS || 'noreply@example.com',
          Destination: { ToAddresses: [to] },
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Text: { Data: bodyText, Charset: 'UTF-8' } },
          },
        }),
      );
    } catch (err) {
      // 寄信失敗不應該中斷排程或核心流程（例如退款成功但通知信失敗），先記錄下來即可
      this.logger.warn(`寄信失敗（${to}）：${(err as Error).message}`);
    }
  }
}
