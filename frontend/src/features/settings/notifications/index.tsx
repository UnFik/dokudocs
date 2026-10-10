import { ContentSection } from '../components/content-section'
import { MentionChannels } from './mention-channels'
import { NotificationsForm } from './notifications-form'

export function SettingsNotifications() {
  return (
    <ContentSection
      title='Notifications'
      desc='Configure how you receive notifications.'
    >
      <div className='flex flex-col gap-8'>
        <section aria-labelledby='mention-channels-title'>
          <h4 id='mention-channels-title' className='text-base font-medium'>
            When someone mentions you
          </h4>
          <MentionChannels />
        </section>
        <NotificationsForm />
      </div>
    </ContentSection>
  )
}
